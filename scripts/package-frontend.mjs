import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
export const defaultSourceDirectory = path.join(
  repositoryRoot,
  "frontend/build",
);
export const defaultDestinationDirectory = path.join(
  repositoryRoot,
  "backend/cmd/openpost/public",
);

const transactionSchemaVersion = 1;
const transactionPhases = new Set([
  "claimed",
  "prepared",
  "staged",
  "swapping",
  "installed",
]);

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".."
  );
}

function validateDistinctDirectories(sourceDirectory, destinationDirectory) {
  const source = path.resolve(sourceDirectory);
  const destination = path.resolve(destinationDirectory);
  if (
    source === destination ||
    isInside(source, destination) ||
    isInside(destination, source)
  ) {
    throw new Error(
      `Frontend package source and destination must be disjoint: ${source} -> ${destination}`,
    );
  }
  return { source, destination };
}

async function artifactEntries(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const pathname = path.join(directory, entry.name);
    const relative = path.relative(root, pathname).split(path.sep).join("/");
    const metadata = await lstat(pathname);
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Frontend artifact must not contain symbolic links: ${relative}`,
      );
    }
    if (metadata.isDirectory()) {
      result.push(...(await artifactEntries(root, pathname)));
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(
        `Frontend artifact contains an unsupported entry: ${relative}`,
      );
    }
    const contents = await readFile(pathname);
    result.push({
      path: relative,
      sha256: createHash("sha256").update(contents).digest("hex"),
      size: contents.length,
      mode: metadata.mode & 0o777,
    });
  }
  return result;
}

export async function artifactManifest(directory) {
  const root = path.resolve(directory);
  const metadata = await lstat(root).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(`Frontend artifact directory does not exist: ${root}`);
    }
    throw error;
  });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Frontend artifact path must be a real directory: ${root}`);
  }
  return artifactEntries(root);
}

async function validateFrontendArtifact(directory) {
  const entries = await artifactManifest(directory);
  const paths = new Set(entries.map((entry) => entry.path));
  for (const required of ["index.html", "app-routes.json"]) {
    if (!paths.has(required)) {
      throw new Error(`Frontend artifact is missing ${required}`);
    }
  }
  const routeManifest = JSON.parse(
    await readFile(path.join(directory, "app-routes.json"), "utf8"),
  );
  if (
    routeManifest?.schema_version !== 1 ||
    !Array.isArray(routeManifest.routes) ||
    !routeManifest.routes.includes("/")
  ) {
    throw new Error("Frontend app-routes.json is not a valid route manifest");
  }
  return entries;
}

function manifestIdentity(manifest) {
  return {
    files: manifest.length,
    sha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
  };
}

function isManifestIdentity(value) {
  return (
    Number.isSafeInteger(value?.files) &&
    value.files >= 0 &&
    typeof value?.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  );
}

function identitiesEqual(left, right) {
  return (
    isManifestIdentity(left) &&
    isManifestIdentity(right) &&
    left.files === right.files &&
    left.sha256 === right.sha256
  );
}

async function pathExists(pathname) {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function inspectArtifact(directory) {
  if (!(await pathExists(directory))) {
    return { exists: false, valid: false, identity: null };
  }
  try {
    const manifest = await validateFrontendArtifact(directory);
    return {
      exists: true,
      valid: true,
      identity: manifestIdentity(manifest),
    };
  } catch {
    return { exists: true, valid: false, identity: null };
  }
}

function transactionPaths(destination, transactionId) {
  const destinationParent = path.dirname(destination);
  const destinationName = path.basename(destination);
  const stageRoot = path.join(
    destinationParent,
    `.${destinationName}-package-stage-${transactionId}`,
  );
  return {
    stageRoot,
    staged: path.join(stageRoot, "artifact"),
    backup: path.join(
      destinationParent,
      `.${destinationName}-package-backup-${transactionId}`,
    ),
  };
}

async function writeJSONAtomic(pathname, value) {
  const temporary = path.join(
    path.dirname(pathname),
    `.${path.basename(pathname)}-${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, pathname);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function claimDirectory(lockDirectory, filename, value) {
  const candidate = `${lockDirectory}.claim-${process.pid}-${randomUUID()}`;
  await mkdir(candidate);
  try {
    await writeJSONAtomic(path.join(candidate, filename), value);
    try {
      await rename(candidate, lockDirectory);
      return true;
    } catch (error) {
      if (await pathExists(lockDirectory)) return false;
      throw error;
    }
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}

async function readJSON(pathname, description) {
  let value;
  try {
    value = JSON.parse(await readFile(pathname, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${description} at ${pathname}`, {
      cause: error,
    });
  }
  return value;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function validateTransaction(transaction, { source, destination }) {
  if (
    transaction?.schema_version !== transactionSchemaVersion ||
    typeof transaction.transaction_id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(transaction.transaction_id) ||
    transaction.source !== source ||
    transaction.destination !== destination ||
    !transactionPhases.has(transaction.phase) ||
    !Number.isSafeInteger(transaction.owner?.pid)
  ) {
    throw new Error("Frontend packaging transaction journal is invalid");
  }
  const expectedPaths = transactionPaths(
    destination,
    transaction.transaction_id,
  );
  for (const key of ["stageRoot", "staged", "backup"]) {
    if (transaction[key] !== expectedPaths[key]) {
      throw new Error(
        `Frontend packaging transaction contains an invalid ${key} path`,
      );
    }
  }
  if (transaction.phase !== "claimed") {
    if (
      !isManifestIdentity(transaction.expected) ||
      typeof transaction.previous?.exists !== "boolean" ||
      typeof transaction.previous?.valid !== "boolean" ||
      (transaction.previous.valid &&
        !isManifestIdentity(transaction.previous.identity)) ||
      (!transaction.previous.valid && transaction.previous.identity !== null)
    ) {
      throw new Error("Frontend packaging transaction identities are invalid");
    }
  }
  return transaction;
}

async function readTransaction(lockDirectory, paths) {
  return validateTransaction(
    await readJSON(
      path.join(lockDirectory, "transaction.json"),
      "frontend packaging transaction",
    ),
    paths,
  );
}

async function updateTransaction(lockDirectory, transaction, updates) {
  Object.assign(transaction, updates);
  await writeJSONAtomic(
    path.join(lockDirectory, "transaction.json"),
    transaction,
  );
}

async function clearDeadRecoveryLock(recoveryLockDirectory) {
  if (!(await pathExists(recoveryLockDirectory))) return;
  const owner = await readJSON(
    path.join(recoveryLockDirectory, "owner.json"),
    "frontend packaging recovery owner",
  );
  if (
    owner?.schema_version !== transactionSchemaVersion ||
    !Number.isSafeInteger(owner.pid)
  ) {
    throw new Error("Frontend packaging recovery owner is invalid");
  }
  if (processIsAlive(owner.pid)) {
    throw new Error("Another frontend packaging recovery is already running");
  }
  await rm(recoveryLockDirectory, { recursive: true, force: true });
}

async function settleTransaction(transaction) {
  const { backup, destination, expected, previous, staged, stageRoot } =
    transaction;
  if (["claimed", "prepared", "staged"].includes(transaction.phase)) {
    if (await pathExists(backup)) {
      throw new Error(
        "Frontend packaging backup exists before the recorded swap phase",
      );
    }
    await rm(stageRoot, { recursive: true, force: true });
    return "unchanged";
  }

  const [destinationState, backupState, stagedState] = await Promise.all([
    inspectArtifact(destination),
    inspectArtifact(backup),
    inspectArtifact(staged),
  ]);

  if (identitiesEqual(destinationState.identity, expected)) {
    await rm(backup, { recursive: true, force: true });
    await rm(stageRoot, { recursive: true, force: true });
    return "installed";
  }

  if (
    previous.valid &&
    identitiesEqual(destinationState.identity, previous.identity) &&
    !backupState.exists
  ) {
    await rm(stageRoot, { recursive: true, force: true });
    return "unchanged";
  }

  if (
    previous.valid &&
    identitiesEqual(backupState.identity, previous.identity)
  ) {
    await rm(destination, { recursive: true, force: true });
    await rename(backup, destination);
    const restored = await inspectArtifact(destination);
    if (!identitiesEqual(restored.identity, previous.identity)) {
      throw new Error("Restored frontend artifact failed its integrity check");
    }
    await rm(stageRoot, { recursive: true, force: true });
    return "restored";
  }

  if (identitiesEqual(stagedState.identity, expected)) {
    await rm(destination, { recursive: true, force: true });
    await rename(staged, destination);
    const installed = await inspectArtifact(destination);
    if (!identitiesEqual(installed.identity, expected)) {
      throw new Error("Recovered frontend artifact failed its integrity check");
    }
    await rm(backup, { recursive: true, force: true });
    await rm(stageRoot, { recursive: true, force: true });
    return "installed";
  }

  if (
    previous.exists &&
    !previous.valid &&
    destinationState.exists &&
    !backupState.exists
  ) {
    await rm(stageRoot, { recursive: true, force: true });
    return "unchanged-invalid";
  }

  if (!previous.exists && !destinationState.exists) {
    await rm(backup, { recursive: true, force: true });
    await rm(stageRoot, { recursive: true, force: true });
    return "unchanged-absent";
  }

  throw new Error(
    "Interrupted frontend packaging has no artifact whose recorded identity can be trusted",
  );
}

async function acquireTransaction({ source, destination }) {
  const destinationParent = path.dirname(destination);
  const destinationName = path.basename(destination);
  const lockDirectory = path.join(
    destinationParent,
    `.${destinationName}-package.lock`,
  );
  const recoveryLockDirectory = path.join(
    destinationParent,
    `.${destinationName}-package-recovery.lock`,
  );

  for (;;) {
    await clearDeadRecoveryLock(recoveryLockDirectory);
    const transactionId = randomUUID();
    const transaction = {
      schema_version: transactionSchemaVersion,
      transaction_id: transactionId,
      owner: { pid: process.pid },
      source,
      destination,
      ...transactionPaths(destination, transactionId),
      phase: "claimed",
      expected: null,
      previous: null,
    };
    if (await claimDirectory(lockDirectory, "transaction.json", transaction)) {
      return { lockDirectory, transaction };
    }

    const interrupted = await readTransaction(lockDirectory, {
      source,
      destination,
    });
    if (processIsAlive(interrupted.owner.pid)) {
      throw new Error(
        `Another frontend packaging operation owns ${lockDirectory}`,
      );
    }
    const recoveryOwner = {
      schema_version: transactionSchemaVersion,
      pid: process.pid,
      transaction_id: interrupted.transaction_id,
    };
    if (
      !(await claimDirectory(
        recoveryLockDirectory,
        "owner.json",
        recoveryOwner,
      ))
    ) {
      throw new Error("Another frontend packaging recovery is already running");
    }
    try {
      const current = await readTransaction(lockDirectory, {
        source,
        destination,
      });
      if (current.transaction_id !== interrupted.transaction_id) {
        throw new Error(
          "Frontend packaging transaction changed during recovery",
        );
      }
      await settleTransaction(current);
      await rm(lockDirectory, { recursive: true, force: true });
    } finally {
      await rm(recoveryLockDirectory, { recursive: true, force: true });
    }
  }
}

export async function packageFrontend({
  sourceDirectory = defaultSourceDirectory,
  destinationDirectory = defaultDestinationDirectory,
  onTransactionPhase,
} = {}) {
  const { source, destination } = validateDistinctDirectories(
    sourceDirectory,
    destinationDirectory,
  );
  const destinationParent = path.dirname(destination);
  await mkdir(destinationParent, { recursive: true });
  const { lockDirectory, transaction } = await acquireTransaction({
    source,
    destination,
  });
  let sourceManifest;
  let operationError;

  try {
    sourceManifest = await validateFrontendArtifact(source);
    const previousState = await inspectArtifact(destination);
    await updateTransaction(lockDirectory, transaction, {
      phase: "prepared",
      expected: manifestIdentity(sourceManifest),
      previous: previousState,
    });

    await mkdir(transaction.stageRoot);
    await cp(source, transaction.staged, {
      recursive: true,
      force: true,
      preserveTimestamps: false,
    });
    const stagedManifest = await validateFrontendArtifact(transaction.staged);
    if (JSON.stringify(stagedManifest) !== JSON.stringify(sourceManifest)) {
      throw new Error("Frontend artifact changed while it was being packaged");
    }
    await updateTransaction(lockDirectory, transaction, { phase: "staged" });
    await updateTransaction(lockDirectory, transaction, { phase: "swapping" });

    if (await pathExists(destination)) {
      await rename(destination, transaction.backup);
      await onTransactionPhase?.("destination-backed-up");
    }
    await rename(transaction.staged, destination);
    await onTransactionPhase?.("destination-installed");
    await updateTransaction(lockDirectory, transaction, { phase: "installed" });
    const installedManifest = await validateFrontendArtifact(destination);
    if (JSON.stringify(installedManifest) !== JSON.stringify(sourceManifest)) {
      throw new Error(
        "Packaged frontend failed its post-install integrity check",
      );
    }
  } catch (error) {
    operationError = error;
  }

  try {
    await settleTransaction(transaction);
    await rm(lockDirectory, { recursive: true, force: true });
  } catch (settlementError) {
    await updateTransaction(lockDirectory, transaction, {
      owner: { pid: -1 },
    }).catch(() => {});
    if (operationError) {
      throw new AggregateError(
        [operationError, settlementError],
        "Frontend packaging failed and could not settle its transaction",
      );
    }
    throw settlementError;
  }

  if (operationError) throw operationError;

  console.log(
    `Packaged ${sourceManifest.length} frontend files into ${path.relative(repositoryRoot, destination)}`,
  );
  return sourceManifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await packageFrontend();
}
