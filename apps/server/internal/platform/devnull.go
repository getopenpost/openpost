package platform

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/openpost/backend/internal/providerlimits"
	"golang.org/x/crypto/ssh"
)

// DevNullAdapter publishes to dev-null.sh (/dev/null, a social network for
// developers) through its SSH-signed CLI commit API.
//
// Unlike OAuth providers, dev-null.sh has no token endpoint. The programmatic
// write path is POST /api/cli/commits, authenticated by an SSHSIG signature
// (ssh-keygen -Y sign) made with a key whose public half is on the author's
// GitHub account, exactly as the `commit` shell script served at
// https://dev-null.sh/commit does. The OpenPost credential is the author's
// OpenSSH private key, stored encrypted like any other provider secret and
// used only to sign commit payloads. Posts are attributed to the GitHub
// account holding that key.
//
// Supported at this stage: top-level commits and replies with 0-3 JPEG, PNG,
// or WebP images. Polls, quotes, and image descriptions exist only in the web
// UI and are not part of the CLI contract, so they stay unavailable.
type DevNullAdapter struct {
	baseURL string
}

// DevNullDefaultBaseURL is the hosted dev-null.sh instance. Tests inject an
// httptest server through NewDevNullAdapter.
const DevNullDefaultBaseURL = "https://dev-null.sh"

const (
	devNullNamespace       = "devnull-commit"
	devNullImagesNamespace = "devnull-commit-images"
)

func NewDevNullAdapter(baseURL string) *DevNullAdapter {
	if trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/"); trimmed != "" {
		return &DevNullAdapter{baseURL: trimmed}
	}
	return &DevNullAdapter{baseURL: DevNullDefaultBaseURL}
}

func (d *DevNullAdapter) BaseURL() string {
	if strings.TrimSpace(d.baseURL) == "" {
		return DevNullDefaultBaseURL
	}
	return d.baseURL
}

func (d *DevNullAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     d.BaseURL(),
		ExecutionMode: ConnectionModeSSHSignature,
		Evidence:      map[string]string{"protocol": "sshsig", "exchange": "key_lookup", "base_url": d.BaseURL()},
	}
}

func (d *DevNullAdapter) GenerateAuthURL(_ string) (string, map[string]string) {
	return "", nil
}

func (d *DevNullAdapter) ExchangeCode(_ context.Context, _ string, _ map[string]string) (*TokenResult, error) {
	return nil, fmt.Errorf("dev/null uses SSH keys, not OAuth redirect")
}

func (d *DevNullAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{Supported: false, CredentialSource: RefreshCredentialNone}
}

func (d *DevNullAdapter) RefreshToken(_ context.Context, _ RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("dev/null credentials do not expire; reconnect to replace the key")
}

// devNullCredential packs the dev/null username and the OpenSSH private key
// into the opaque access token. GetProfile needs the username while Publish
// needs the key, and the Publisher interface only passes one credential
// string, so both travel together. The composite is encrypted at rest by the
// account saver like any other provider secret.
func devNullCredential(username, privateKeyPEM string) string {
	return strings.TrimSpace(username) + "\n" + strings.TrimSpace(privateKeyPEM)
}

func splitDevNullCredential(accessToken string) (username, privateKeyPEM string, err error) {
	username, key, found := strings.Cut(accessToken, "\n")
	username = strings.TrimSpace(username)
	key = strings.TrimSpace(key)
	if !found || username == "" || key == "" {
		return "", "", fmt.Errorf("dev/null credential is malformed; reconnect the account")
	}
	return username, key, nil
}

var devNullUsernamePattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`)

func validateDevNullUsername(username string) error {
	if !devNullUsernamePattern.MatchString(strings.TrimSpace(username)) {
		return fmt.Errorf("dev/null username %q is not a valid GitHub-style username", username)
	}
	return nil
}

// Login verifies an SSH private key against dev-null.sh and returns a
// composite credential for it. The key must already be on the author's GitHub
// account; dev-null.sh re-checks GitHub when the commit is sent, so a key
// removed from GitHub stops working shortly after. The private key is
// exchanged once here and then stored encrypted, never logged.
func (d *DevNullAdapter) Login(ctx context.Context, username, privateKeyPEM string) (*TokenResult, *UserProfile, error) {
	username = strings.TrimSpace(username)
	if err := validateDevNullUsername(username); err != nil {
		return nil, nil, err
	}
	signer, err := parseDevNullPrivateKey(privateKeyPEM)
	if err != nil {
		return nil, nil, err
	}
	publicLine := devNullPublicKeyLine(signer.PublicKey())
	if err := d.verifyKeyOwnership(ctx, publicLine); err != nil {
		return nil, nil, err
	}
	profile, err := d.fetchUserProfile(ctx, username)
	if err != nil {
		return nil, nil, err
	}
	return &TokenResult{
		AccessToken: devNullCredential(username, privateKeyPEM),
		TokenType:   ConnectionModeSSHSignature,
	}, profile, nil
}

func parseDevNullPrivateKey(privateKeyPEM string) (ssh.Signer, error) {
	trimmed := strings.TrimSpace(privateKeyPEM)
	if trimmed == "" {
		return nil, fmt.Errorf("dev/null connection requires an SSH private key")
	}
	signer, err := ssh.ParsePrivateKey([]byte(trimmed))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "passphrase") {
			return nil, fmt.Errorf("dev/null private key is encrypted; use a dedicated passphrase-free deploy key instead")
		}
		return nil, fmt.Errorf("dev/null private key could not be parsed: %v", err)
	}
	switch signer.PublicKey().Type() {
	case "ssh-ed25519":
		return signer, nil
	case "ssh-rsa":
		if bits := devNullRSABitLen(signer.PublicKey()); bits < 2048 {
			return nil, fmt.Errorf("dev/null RSA keys must be at least 2048 bits")
		}
		return signer, nil
	default:
		return nil, fmt.Errorf("dev/null accepts Ed25519 or RSA SSH keys, not %s", signer.PublicKey().Type())
	}
}

// devNullRSABitLen reports the RSA modulus size, or 0 when the public key
// does not expose a usable RSA key. dev/null rejects RSA below 2048 bits at
// signature verification time, so connecting with one would fail every
// publish; reject it at connect instead.
func devNullRSABitLen(pub ssh.PublicKey) int {
	cryptoPub, ok := pub.(ssh.CryptoPublicKey)
	if !ok {
		return 0
	}
	rsaPub, ok := cryptoPub.CryptoPublicKey().(*rsa.PublicKey)
	if !ok || rsaPub.N == nil {
		return 0
	}
	return rsaPub.N.BitLen()
}

func devNullPublicKeyLine(pub ssh.PublicKey) string {
	return pub.Type() + " " + base64.StdEncoding.EncodeToString(pub.Marshal())
}

// verifyKeyOwnership asks dev-null.sh which of our public keys belongs to a
// dev/null user, mirroring the key-lookup step of the official commit script.
// Anyone may call this endpoint; the GitHub re-check happens at commit time.
func (d *DevNullAdapter) verifyKeyOwnership(ctx context.Context, publicLine string) error {
	body, err := DoRequest(ctx, http.MethodPost, d.BaseURL()+"/api/cli/key-lookups", strings.NewReader(publicLine+"\n"), map[string]string{
		headerContentType: "text/plain; charset=utf-8",
	})
	if err != nil {
		return fmt.Errorf("dev/null key lookup failed: %w", normalizeDevNullError(err))
	}
	fields := strings.Fields(strings.TrimSpace(string(body)))
	if len(fields) < 2 {
		return fmt.Errorf("dev/null did not recognize this SSH key; add it to your GitHub account (Settings > SSH and GPG keys), sign in at dev-null.sh, then try again")
	}
	want := strings.Fields(publicLine)
	if fields[0] != want[0] || fields[1] != want[1] {
		return fmt.Errorf("dev/null answered the key lookup with an unexpected key")
	}
	return nil
}

type devNullUserResponse struct {
	Data struct {
		ID        string `json:"id"`
		Username  string `json:"username"`
		Handle    string `json:"handle"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
	} `json:"data"`
}

func (d *DevNullAdapter) fetchUserProfile(ctx context.Context, username string) (*UserProfile, error) {
	endpoint := d.BaseURL() + "/api/v1/users/" + url.PathEscape(strings.TrimSpace(username))
	body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("dev/null profile lookup failed: %w", normalizeDevNullError(err))
	}
	var response devNullUserResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding dev/null profile: %w", err)
	}
	handle := firstNonEmptyString(response.Data.Handle, response.Data.Username)
	if strings.TrimSpace(handle) == "" {
		return nil, fmt.Errorf("dev/null user %q was not found", username)
	}
	return &UserProfile{
		ID:              firstNonEmptyString(response.Data.ID, handle),
		Username:        handle,
		DisplayName:     firstNonEmptyString(response.Data.Name, handle),
		AvatarURL:       strings.TrimSpace(response.Data.AvatarURL),
		CapabilityState: map[string]string{"devnull_key_type": "ssh_signature"},
	}, nil
}

func (d *DevNullAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	username, _, err := splitDevNullCredential(accessToken)
	if err != nil {
		return nil, err
	}
	return d.fetchUserProfile(ctx, username)
}

func (d *DevNullAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", fmt.Errorf("dev/null images are attached when the commit is sent")
}

// Publish sends a text-only commit through the CLI contract. All local
// validation happens before the durable write fence opens, so content errors
// fail fast instead of recording an ambiguous provider write.
func (d *DevNullAdapter) Publish(ctx context.Context, accessToken, _ string, req *PublishRequest) (PublishResult, error) {
	if len(req.PlatformMediaIDs) > 0 {
		return PublishResult{}, fmt.Errorf("dev/null images are attached when the commit is sent")
	}
	signer, replyTo, err := d.prepareCommit(accessToken, req)
	if err != nil {
		return PublishResult{}, err
	}
	return executePublishWrite(req, "sign_commit", func() (string, error) {
		return d.sendCommit(ctx, signer, replyTo, req.Content, nil)
	})
}

// PublishWithMedia sends a commit with 0-3 images as one multipart request,
// mirroring the official commit script: the payload travels as a `payload`
// file part next to `images[]` file parts.
func (d *DevNullAdapter) PublishWithMedia(ctx context.Context, accessToken, _ string, req *PublishRequest, media []UploadMediaRequest) (PublishResult, error) {
	if len(media) == 0 {
		return d.Publish(ctx, accessToken, "", req)
	}
	if len(media) > providerlimits.DevNullMaxImages {
		return PublishResult{}, fmt.Errorf("dev/null commits carry up to %d images", providerlimits.DevNullMaxImages)
	}
	signer, replyTo, images, err := d.prepareImageCommit(accessToken, req, media)
	if err != nil {
		return PublishResult{}, err
	}
	return executePublishWrite(req, "sign_commit_images", func() (string, error) {
		return d.sendCommit(ctx, signer, replyTo, req.Content, images)
	})
}

type devNullImagePayload struct {
	filename string
	mimeType string
	data     []byte
}

// prepareCommit runs every local check before the durable write fence opens:
// credential parsing, text validation, and reply resolution. Only signing
// (fresh timestamp and nonce per attempt) and the POST itself happen inside
// the fence, so content errors fail fast instead of recording an ambiguous
// provider write.
func (d *DevNullAdapter) prepareCommit(accessToken string, req *PublishRequest) (ssh.Signer, string, error) {
	_, privateKeyPEM, err := splitDevNullCredential(accessToken)
	if err != nil {
		return nil, "", err
	}
	signer, err := parseDevNullPrivateKey(privateKeyPEM)
	if err != nil {
		return nil, "", err
	}
	if err := validateDevNullText(req.Content); err != nil {
		return nil, "", err
	}
	replyTo, err := devNullReplyRef(req.ReplyToID)
	if err != nil {
		return nil, "", err
	}
	return signer, replyTo, nil
}

func (d *DevNullAdapter) prepareImageCommit(accessToken string, req *PublishRequest, media []UploadMediaRequest) (ssh.Signer, string, []devNullImagePayload, error) {
	signer, replyTo, err := d.prepareCommit(accessToken, req)
	if err != nil {
		return nil, "", nil, err
	}
	images := make([]devNullImagePayload, 0, len(media))
	for _, item := range media {
		image, err := readDevNullImage(item)
		if err != nil {
			return nil, "", nil, err
		}
		images = append(images, image)
	}
	return signer, replyTo, images, nil
}

// sendCommit signs the payload and posts it. It runs inside the write fence
// so the signature timestamp and nonce reflect the actual send attempt.
func (d *DevNullAdapter) sendCommit(ctx context.Context, signer ssh.Signer, replyTo, body string, images []devNullImagePayload) (string, error) {
	namespace := devNullNamespace
	payload := ""
	if len(images) == 0 {
		payload = devNullPayload(replyTo, body, nil)
	} else {
		namespace = devNullImagesNamespace
		hashes := make([]string, 0, len(images))
		for _, image := range images {
			hashes = append(hashes, devNullSHA256Hex(image.data))
		}
		payload = devNullPayload(replyTo, body, hashes)
	}
	signature, err := signDevNullPayload(signer, namespace, []byte(payload))
	if err != nil {
		return "", err
	}
	if len(images) == 0 {
		return d.postTextCommit(ctx, payload, signature)
	}
	return d.postImageCommit(ctx, payload, signature, images)
}

// validateDevNullText enforces the CLI contract limits in characters:
// dev/null measures MAX_BODY_LENGTH with mb_strlen after collapsing blank
// runs, and requires a body even with images attached. Counting raw runes is
// conservative: normalization only shrinks the body, so a raw body within
// limits always passes server-side too.
func validateDevNullText(content string) error {
	if providerlimits.TextLength(providerDevNull, content) > providerlimits.DevNullMaxBodyBytes {
		return fmt.Errorf("dev/null commits hold %d characters or less", providerlimits.DevNullMaxBodyBytes)
	}
	// The CLI contract requires a body even with images attached.
	if providerlimits.TextLength(providerDevNull, strings.TrimSpace(content)) < 3 {
		return fmt.Errorf("dev/null commits need at least 3 characters")
	}
	return nil
}

var devNullReplyRefPattern = regexp.MustCompile(`^[A-Za-z0-9:/._@-]*$`)

// devNullReplyRef passes an OpenPost thread parent through to dev/null's
// reply_to reference, which accepts a commit UUID, short hash, or link.
// CommitByReferenceQuery extracts a UUID from any string containing one, so
// stored commit URLs round-trip here unchanged.
func devNullReplyRef(replyToID string) (string, error) {
	trimmed := strings.TrimSpace(replyToID)
	if trimmed == "" {
		return "", nil
	}
	if !devNullReplyRefPattern.MatchString(trimmed) {
		return "", fmt.Errorf("dev/null replies take a commit hash or link")
	}
	return trimmed, nil
}

func readDevNullImage(item UploadMediaRequest) (devNullImagePayload, error) {
	mimeType := strings.ToLower(strings.TrimSpace(item.MimeType))
	switch mimeType {
	case "image/jpeg", "image/png", "image/webp":
	default:
		return devNullImagePayload{}, fmt.Errorf("dev/null commits accept JPEG, PNG, or WebP images, not %s", item.MimeType)
	}
	if item.Reader == nil {
		return devNullImagePayload{}, fmt.Errorf("dev/null image %q has no data", item.Filename)
	}
	limited := io.LimitReader(item.Reader, int64(providerlimits.DevNullMaxImageBytes)+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return devNullImagePayload{}, fmt.Errorf("reading dev/null image: %w", err)
	}
	if len(data) == 0 {
		return devNullImagePayload{}, fmt.Errorf("dev/null image %q is empty", item.Filename)
	}
	if len(data) > providerlimits.DevNullMaxImageBytes {
		return devNullImagePayload{}, fmt.Errorf("dev/null images must be 10 MB or less")
	}
	return devNullImagePayload{filename: firstNonEmptyString(item.Filename, "image"), mimeType: mimeType, data: data}, nil
}

func devNullSHA256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// devNullPayload builds the exact signed payload the official commit script
// sends: "<timestamp>\n<nonce>\n<reply_to>\n<body>", with a comma-separated
// image-hash line before the body when images are attached. The body keeps
// its newlines; the server splits on the first 3 (or 4) newlines.
func devNullPayload(replyTo, body string, imageHashes []string) string {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		// Fall back to a timestamp-derived nonce rather than failing the
		// publish; the server's replay cache still rejects true replays.
		nonce = []byte(fmt.Sprintf("%016x", time.Now().UTC().UnixNano()))
	}
	timestamp := fmt.Sprintf("%d", time.Now().UTC().Unix())
	if len(imageHashes) == 0 {
		return timestamp + "\n" + hex.EncodeToString(nonce) + "\n" + replyTo + "\n" + body
	}
	return timestamp + "\n" + hex.EncodeToString(nonce) + "\n" + replyTo + "\n" + strings.Join(imageHashes, ",") + "\n" + body
}

// signDevNullPayload creates an SSHSIG signature (PROTOCOL.sshsig) over the
// payload, the same bytes `ssh-keygen -Y sign` produces. RSA keys sign with
// rsa-sha2-512; the server also accepts rsa-sha2-256 and ssh-ed25519.
func signDevNullPayload(signer ssh.Signer, namespace string, payload []byte) (string, error) {
	sum := sha512.Sum512(payload)
	var buf bytes.Buffer
	buf.WriteString("SSHSIG")
	writeDevNullSSHString(&buf, []byte(namespace))
	writeDevNullSSHString(&buf, []byte(""))
	writeDevNullSSHString(&buf, []byte("sha512"))
	writeDevNullSSHString(&buf, sum[:])
	signature, err := devNullSign(signer, buf.Bytes())
	if err != nil {
		return "", err
	}
	var outer bytes.Buffer
	outer.WriteString("SSHSIG")
	writeDevNullUint32(&outer, 1)
	writeDevNullSSHString(&outer, signer.PublicKey().Marshal())
	writeDevNullSSHString(&outer, []byte(namespace))
	writeDevNullSSHString(&outer, []byte(""))
	writeDevNullSSHString(&outer, []byte("sha512"))
	var inner bytes.Buffer
	writeDevNullSSHString(&inner, []byte(signature.Format))
	writeDevNullSSHString(&inner, signature.Blob)
	writeDevNullSSHString(&outer, inner.Bytes())
	return base64.StdEncoding.EncodeToString(outer.Bytes()), nil
}

func devNullSign(signer ssh.Signer, data []byte) (*ssh.Signature, error) {
	if signer.PublicKey().Type() == "ssh-rsa" {
		algorithmSigner, ok := signer.(ssh.AlgorithmSigner)
		if !ok {
			return nil, fmt.Errorf("dev/null RSA signing requires algorithm negotiation")
		}
		// rsa-sha2-512 is accepted by dev/null; the legacy ssh-rsa (SHA-1)
		// default is not, so never fall back to plain Sign for RSA keys.
		return algorithmSigner.SignWithAlgorithm(rand.Reader, data, ssh.KeyAlgoRSASHA512)
	}
	return signer.Sign(rand.Reader, data)
}

func writeDevNullSSHString(buf *bytes.Buffer, data []byte) {
	writeDevNullUint32(buf, uint32(len(data)))
	buf.Write(data)
}

func writeDevNullUint32(buf *bytes.Buffer, value uint32) {
	var scratch [4]byte
	binary.BigEndian.PutUint32(scratch[:], value)
	buf.Write(scratch[:])
}

func (d *DevNullAdapter) postTextCommit(ctx context.Context, payload, signature string) (string, error) {
	body, err := DoRequest(ctx, http.MethodPost, d.BaseURL()+"/api/cli/commits", strings.NewReader(payload), map[string]string{
		headerContentType: "text/plain; charset=utf-8",
		"X-SSH-Signature": signature,
	})
	if err != nil {
		return "", fmt.Errorf("dev/null commit failed: %w", normalizeDevNullError(err))
	}
	return parseDevNullCommitResponse(body)
}

func (d *DevNullAdapter) postImageCommit(ctx context.Context, payload, signature string, images []devNullImagePayload) (string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	payloadPart, err := writer.CreateFormFile("payload", "commit")
	if err != nil {
		return "", fmt.Errorf("building dev/null commit: %w", err)
	}
	if _, err := payloadPart.Write([]byte(payload)); err != nil {
		return "", fmt.Errorf("building dev/null commit: %w", err)
	}
	for i, image := range images {
		part, err := writer.CreateFormFile("images[]", fmt.Sprintf("image-%d", i+1))
		if err != nil {
			return "", fmt.Errorf("building dev/null commit: %w", err)
		}
		if _, err := part.Write(image.data); err != nil {
			return "", fmt.Errorf("building dev/null commit: %w", err)
		}
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("building dev/null commit: %w", err)
	}
	body, err := DoRequest(ctx, http.MethodPost, d.BaseURL()+"/api/cli/commits", &buf, map[string]string{
		headerContentType: writer.FormDataContentType(),
		"X-SSH-Signature": signature,
	})
	if err != nil {
		return "", fmt.Errorf("dev/null commit failed: %w", normalizeDevNullError(err))
	}
	return parseDevNullCommitResponse(body)
}

var devNullCommitURLPattern = regexp.MustCompile(`https://\S+`)

// parseDevNullCommitResponse extracts the commit URL from the plain-text
// "Committed: {url}" answer. The URL is the durable external ID: it embeds
// the commit UUID, which dev/null's reply reference resolves, and it doubles
// as the public post URL.
func parseDevNullCommitResponse(body []byte) (string, error) {
	trimmed := strings.TrimSpace(string(body))
	match := devNullCommitURLPattern.FindString(trimmed)
	if match == "" {
		return "", fmt.Errorf("dev/null answered without a commit link")
	}
	match = strings.TrimRight(match, ".,;:!?)]}")
	if _, err := url.ParseRequestURI(match); err != nil {
		return "", fmt.Errorf("dev/null answered with an invalid commit link")
	}
	return match, nil
}

// normalizeDevNullError tags the typed provider error with a stable dev/null
// code while keeping the *HTTPError in the chain. Callers (failure
// classification, the durable write fence) key on the type, status, and
// Retry-After: replacing it with a plain error would record rejections as
// ambiguous manual-resolution writes and drop the 429 backoff.
func normalizeDevNullError(err error) error {
	httpErr, ok := asDevNullHTTPError(err)
	if !ok {
		return err
	}
	switch httpErr.StatusCode {
	case http.StatusUnauthorized:
		httpErr.Code = "devnull:signature_rejected"
	case http.StatusNotFound:
		httpErr.Code = "devnull:key_or_user_unknown"
	case http.StatusUnprocessableEntity:
		httpErr.Code = "devnull:commit_rejected"
	case http.StatusTooManyRequests:
		httpErr.Code = "devnull:rate_limited"
	}
	return err
}

func asDevNullHTTPError(err error) (*HTTPError, bool) {
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		return httpErr, true
	}
	return nil, false
}

func validateDevNullMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return nil
	}
	if len(media) > providerlimits.DevNullMaxImages {
		return []MediaValidationIssue{{
			Provider: providerDevNull,
			Severity: severityError,
			Message:  fmt.Sprintf("dev/null commits carry up to %d images.", providerlimits.DevNullMaxImages),
		}}
	}
	for _, item := range media {
		switch strings.ToLower(strings.TrimSpace(item.MimeType)) {
		case "image/jpeg", "image/png", "image/webp":
		default:
			return []MediaValidationIssue{{
				Provider: providerDevNull,
				MediaID:  item.ID,
				Severity: severityError,
				Message:  "dev/null commits accept JPEG, PNG, or WebP images.",
			}}
		}
		if item.Size > int64(providerlimits.DevNullMaxImageBytes) {
			return []MediaValidationIssue{{
				Provider: providerDevNull,
				MediaID:  item.ID,
				Severity: severityError,
				Message:  "dev/null images must be 10 MB or less.",
			}}
		}
	}
	return nil
}
