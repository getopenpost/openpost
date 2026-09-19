export function reportProblems(label, problems) {
  if (problems.length > 0) {
    console.error(`${label}:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    process.exit(1);
  }
}
