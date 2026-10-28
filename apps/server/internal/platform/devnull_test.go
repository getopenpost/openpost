package platform

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha512"
	"encoding/base64"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/providerlimits"
	"golang.org/x/crypto/ssh"
)

func devNullTestSigner(t *testing.T) (ssh.Signer, string) {
	t.Helper()
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKey(crypto.PrivateKey(private), "")
	if err != nil {
		t.Fatal(err)
	}
	return signer, string(pem.EncodeToMemory(block))
}

func devNullTestServer(t *testing.T, commits http.HandlerFunc) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/cli/key-lookups", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		line := strings.TrimSpace(string(body))
		if line == "" {
			http.Error(w, "missing key", http.StatusBadRequest)
			return
		}
		fmt.Fprintln(w, line)
	})
	mux.HandleFunc("/api/v1/users/testuser", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":{"id":"00000000-0000-4000-8000-000000000001","username":"testuser","name":"Test User","avatar_url":"https://example.com/avatar.png"}}`)
	})
	mux.HandleFunc("/api/cli/commits", commits)
	server := newProviderTestServer(t, mux)
	return server
}

func devNullSignatureParts(t *testing.T, armored string) (namespace, hashAlg, keyType string, pubBlob, signature []byte) {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(armored)
	if err != nil {
		t.Fatalf("signature is not base64: %v", err)
	}
	if !strings.HasPrefix(string(raw), "SSHSIG") {
		t.Fatalf("signature misses SSHSIG magic")
	}
	rest := raw[len("SSHSIG"):]
	if len(rest) < 4 {
		t.Fatal("truncated signature version")
	}
	// The version is a raw uint32 ('N'), not an SSH string.
	version := binary.BigEndian.Uint32(rest[:4])
	rest = rest[4:]
	if version != 1 {
		t.Fatalf("unexpected signature version %d", version)
	}
	readString := func() []byte {
		if len(rest) < 4 {
			t.Fatal("truncated signature blob")
		}
		length := binary.BigEndian.Uint32(rest[:4])
		rest = rest[4:]
		if uint32(len(rest)) < length {
			t.Fatal("truncated signature string")
		}
		out := rest[:length]
		rest = rest[length:]
		return out
	}
	pubBlob = readString()
	namespace = string(readString())
	_ = readString() // reserved
	hashAlg = string(readString())
	signature = readString()
	if len(rest) != 0 {
		t.Fatalf("trailing bytes in signature blob")
	}
	inner := signature
	readInner := func() []byte {
		if len(inner) < 4 {
			t.Fatal("truncated inner signature")
		}
		length := binary.BigEndian.Uint32(inner[:4])
		inner = inner[4:]
		if uint32(len(inner)) < length {
			t.Fatal("truncated inner signature string")
		}
		out := inner[:length]
		inner = inner[length:]
		return out
	}
	keyType = string(readInner())
	sigBytes := readInner()
	if len(inner) != 0 {
		t.Fatalf("trailing bytes in inner signature")
	}
	return namespace, hashAlg, keyType, pubBlob, sigBytes
}

// TestDevNullSignatureVerifiesWithSSHKeygen proves interop with the real
// verifier the server shells out to semantically. Skipped where ssh-keygen
// is unavailable.
func TestDevNullSignatureVerifiesWithSSHKeygen(t *testing.T) {
	if _, err := exec.LookPath("ssh-keygen"); err != nil {
		t.Skip("ssh-keygen is unavailable")
	}
	signer, pemKey := devNullTestSigner(t)
	dir := t.TempDir()
	payload := devNullPayload("01a14c0f", "Hello from OpenPost", nil)
	dataPath := dir + "/commit"
	if err := os.WriteFile(dataPath, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	armored, err := signDevNullPayload(signer, devNullNamespace, []byte(payload))
	if err != nil {
		t.Fatal(err)
	}
	var armoredFile strings.Builder
	armoredFile.WriteString("-----BEGIN SSH SIGNATURE-----\n")
	for i := 0; i < len(armored); i += 70 {
		end := min(i+70, len(armored))
		armoredFile.WriteString(armored[i:end] + "\n")
	}
	armoredFile.WriteString("-----END SSH SIGNATURE-----\n")
	sigPath := dir + "/commit.sig"
	if err := os.WriteFile(sigPath, []byte(armoredFile.String()), 0o600); err != nil {
		t.Fatal(err)
	}
	allowedPath := dir + "/allowed"
	if err := os.WriteFile(allowedPath, []byte("testuser "+devNullPublicKeyLine(signer.PublicKey())+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_ = pemKey
	cmd := exec.CommandContext(t.Context(), "ssh-keygen", "-Y", "verify", "-f", allowedPath, "-I", "testuser", "-n", devNullNamespace, "-s", sigPath)
	cmd.Stdin = strings.NewReader(payload)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ssh-keygen verification failed: %v\n%s", err, out)
	}
}

func TestDevNullRSASignatureAlgorithm(t *testing.T) {
	private, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	armored, err := signDevNullPayload(signer, devNullNamespace, []byte("test"))
	if err != nil {
		t.Fatal(err)
	}
	namespace, hashAlg, keyType, _, _ := devNullSignatureParts(t, armored)
	if namespace != devNullNamespace {
		t.Fatalf("signature namespace = %q, want %q", namespace, devNullNamespace)
	}
	if hashAlg != "sha512" {
		t.Fatalf("signature hash algorithm = %q, want sha512", hashAlg)
	}
	if keyType != ssh.KeyAlgoRSASHA512 {
		t.Fatalf("RSA signature algorithm = %q, want rsa-sha2-512", keyType)
	}
}

func TestDevNullPayloadFormat(t *testing.T) {
	plain := devNullPayload("", "hello world", nil)
	parts := strings.SplitN(plain, "\n", 4)
	if len(parts) != 4 || parts[2] != "" || parts[3] != "hello world" {
		t.Fatalf("plain payload = %q", plain)
	}
	if len(parts[1]) != 32 {
		t.Fatalf("nonce = %q", parts[1])
	}
	withImages := devNullPayload("deadbee", "hi there", []string{"aa", "bb"})
	imageParts := strings.SplitN(withImages, "\n", 5)
	if len(imageParts) != 5 || imageParts[2] != "deadbee" || imageParts[3] != "aa,bb" || imageParts[4] != "hi there" {
		t.Fatalf("image payload = %q", withImages)
	}
	multiline := devNullPayload("", "one\n\ntwo", nil)
	if got := strings.SplitN(multiline, "\n", 4)[3]; got != "one\n\ntwo" {
		t.Fatalf("body newlines not preserved: %q", got)
	}
}

// Verify the actual outbound SSHSIG envelope and signed commit bytes against
// the same public key used to log in, independently of the production encoder.
func TestDevNullLoginAndTextPublish(t *testing.T) {
	var gotSignature, gotContentType, gotBody string
	server := devNullTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotSignature = r.Header.Get("X-SSH-Signature")
		gotContentType = r.Header.Get("Content-Type")
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintln(w, "Committed: https://dev-null.sh/@testuser/commits/01a14c0f-6e52-4b1c-9a1d-2f4b5c6d7e8f")
	})
	adapter := NewDevNullAdapter(server.URL)
	signer, pemKey := devNullTestSigner(t)
	token, profile, err := adapter.Login(context.Background(), "testuser", pemKey)
	if err != nil {
		t.Fatal(err)
	}
	if profile.Username != "testuser" || profile.ID == "" {
		t.Fatalf("profile = %+v", profile)
	}
	username, _, err := splitDevNullCredential(token.AccessToken)
	if err != nil || username != "testuser" {
		t.Fatalf("credential username = %q, err = %v", username, err)
	}
	result, err := adapter.Publish(context.Background(), token.AccessToken, profile.ID, &PublishRequest{Content: "Hello from OpenPost"})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExternalID != "https://dev-null.sh/@testuser/commits/01a14c0f-6e52-4b1c-9a1d-2f4b5c6d7e8f" {
		t.Fatalf("external ID = %q", result.ExternalID)
	}
	if !strings.HasPrefix(gotContentType, "text/plain") {
		t.Fatalf("content type = %q", gotContentType)
	}
	if _, err := base64.StdEncoding.DecodeString(gotSignature); err != nil {
		t.Fatalf("signature header is not base64: %v", err)
	}
	if !strings.HasSuffix(gotBody, "\nHello from OpenPost") {
		t.Fatalf("payload body = %q", gotBody)
	}
	namespace, hashAlg, keyType, pubBlob, sigBytes := devNullSignatureParts(t, gotSignature)
	if namespace != devNullNamespace {
		t.Fatalf("namespace = %q", namespace)
	}
	if hashAlg != "sha512" {
		t.Fatalf("hash algorithm = %q", hashAlg)
	}
	pub, err := ssh.ParsePublicKey(pubBlob)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(pub.Marshal(), signer.PublicKey().Marshal()) {
		t.Fatal("commit signature uses a different public key than the login credential")
	}
	if pub.Type() != "ssh-ed25519" {
		t.Fatalf("key type = %q", pub.Type())
	}
	if keyType != "ssh-ed25519" {
		t.Fatalf("signature algorithm = %q", keyType)
	}
	sum := sha512.Sum512([]byte(gotBody))
	var signedData []byte
	signedData = append(signedData, "SSHSIG"...)
	for _, part := range [][]byte{[]byte(devNullNamespace), {}, []byte("sha512"), sum[:]} {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(part)))
		signedData = append(signedData, length[:]...)
		signedData = append(signedData, part...)
	}
	if err := pub.Verify(signedData, &ssh.Signature{Format: keyType, Blob: sigBytes}); err != nil {
		t.Fatalf("server-shaped verification failed: %v", err)
	}
}

func TestDevNullPendingCommitStillSucceeds(t *testing.T) {
	server := devNullTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintln(w, "Committed: https://dev-null.sh/@testuser/commits/01a14c0f (pending review, only you can see it until it is approved)")
	})
	adapter := NewDevNullAdapter(server.URL)
	_, pemKey := devNullTestSigner(t)
	token, _, err := adapter.Login(context.Background(), "testuser", pemKey)
	if err != nil {
		t.Fatal(err)
	}
	result, err := adapter.Publish(context.Background(), token.AccessToken, "id", &PublishRequest{Content: "needs moderation"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(result.ExternalID, "https://dev-null.sh/@testuser/commits/") {
		t.Fatalf("external ID = %q", result.ExternalID)
	}
}

func TestDevNullImagePublishUsesMultipart(t *testing.T) {
	var contentType string
	var payloadFile, imageCount int
	server := devNullTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		contentType = r.Header.Get("Content-Type")
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			t.Errorf("parse multipart: %v", err)
		}
		payloadFile = len(r.MultipartForm.File["payload"])
		imageCount = len(r.MultipartForm.File["images[]"])
		signature := r.Header.Get("X-SSH-Signature")
		if _, err := base64.StdEncoding.DecodeString(signature); err != nil {
			t.Errorf("signature header is not base64: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintln(w, "Committed: https://dev-null.sh/@testuser/commits/01a14c0f")
	})
	adapter := NewDevNullAdapter(server.URL)
	_, pemKey := devNullTestSigner(t)
	token, _, err := adapter.Login(context.Background(), "testuser", pemKey)
	if err != nil {
		t.Fatal(err)
	}
	// Minimal PNG header bytes; the fake server does not validate images.
	image := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	_, err = adapter.PublishWithMedia(context.Background(), token.AccessToken, "id",
		&PublishRequest{Content: "shipped it"},
		[]UploadMediaRequest{{MimeType: "image/png", Filename: "ship.png", Size: int64(len(image)), Reader: strings.NewReader(string(image))}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(contentType, "multipart/form-data") {
		t.Fatalf("content type = %q", contentType)
	}
	if payloadFile != 1 || imageCount != 1 {
		t.Fatalf("payload files = %d, image files = %d", payloadFile, imageCount)
	}
}

func TestDevNullPublishMapsProviderErrors(t *testing.T) {
	cases := map[int]string{
		http.StatusUnauthorized:        "devnull:signature_rejected",
		http.StatusNotFound:            "devnull:key_or_user_unknown",
		http.StatusUnprocessableEntity: "devnull:commit_rejected",
		http.StatusTooManyRequests:     "devnull:rate_limited",
	}
	for status, wantCode := range cases {
		server := devNullTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "nope", status)
		})
		adapter := NewDevNullAdapter(server.URL)
		_, pemKey := devNullTestSigner(t)
		token, _, err := adapter.Login(context.Background(), "testuser", pemKey)
		if err != nil {
			t.Fatal(err)
		}
		_, err = adapter.Publish(context.Background(), token.AccessToken, "id", &PublishRequest{Content: "Hello from OpenPost"})
		if err == nil {
			t.Fatalf("status %d: expected an error", status)
		}
		var httpErr *HTTPError
		if !errors.As(err, &httpErr) {
			t.Fatalf("status %d: error is not a typed provider error: %v", status, err)
		}
		if httpErr.Code != wantCode {
			t.Fatalf("status %d: code = %q, want %q", status, httpErr.Code, wantCode)
		}
	}
}

func TestDevNullValidation(t *testing.T) {
	RegisterAllMediaValidators()
	if err := validateDevNullText("hi"); err == nil {
		t.Fatal("expected short body to fail")
	}
	if err := validateDevNullText(strings.Repeat("a", providerlimits.DevNullMaxBodyBytes+1)); err == nil {
		t.Fatal("expected long body to fail")
	}
	if err := validateDevNullText("hey"); err != nil {
		t.Fatalf("short valid body failed: %v", err)
	}
	if _, err := devNullReplyRef("not a ref!"); err == nil {
		t.Fatal("expected bad reply ref to fail")
	}
	if _, err := devNullReplyRef("https://dev-null.sh/@testuser/commits/01a14c0f"); err != nil {
		t.Fatalf("link reply ref failed: %v", err)
	}
	issues := ValidateMedia(providerDevNull, []MediaItem{{ID: "1", MimeType: "image/gif"}})
	if len(issues) == 0 {
		t.Fatal("expected GIF to fail validation")
	}
	many := []MediaItem{{ID: "1", MimeType: "image/png"}, {ID: "2", MimeType: "image/png"}, {ID: "3", MimeType: "image/png"}, {ID: "4", MimeType: "image/png"}}
	if issues := ValidateMedia(providerDevNull, many); len(issues) == 0 {
		t.Fatal("expected 4 images to fail validation")
	}
	big := []MediaItem{{ID: "1", MimeType: "image/png", Size: int64(providerlimits.DevNullMaxImageBytes) + 1}}
	if issues := ValidateMedia(providerDevNull, big); len(issues) == 0 {
		t.Fatal("expected oversize image to fail validation")
	}
	if _, _, err := splitDevNullCredential("no-newline"); err == nil {
		t.Fatal("expected malformed credential to fail")
	}
	if err := validateDevNullUsername("not a user!"); err == nil {
		t.Fatal("expected bad username to fail")
	}
	if _, err := parseDevNullPrivateKey("not a key"); err == nil {
		t.Fatal("expected bad key to fail")
	}
	if _, err := parseDevNullPrivateKey(""); err == nil {
		t.Fatal("expected empty key to fail")
	}
}

func TestDevNullRegistryAndContract(t *testing.T) {
	if err := ValidateAppConfig(AppConfig{Provider: "devnull"}); err != nil {
		t.Fatalf("devnull app config invalid: %v", err)
	}
	adapters, _, err := BuildAdapterRegistry([]AppConfig{{Provider: "devnull"}}, RegistryOptions{})
	if err != nil {
		t.Fatalf("registry build failed: %v", err)
	}
	if adapters["devnull"] == nil {
		t.Fatal("devnull adapter missing from registry")
	}
}

func TestDevNullTextLimitCountsCharacters(t *testing.T) {
	// 4000 multibyte characters are ~12000 bytes and must pass: dev/null
	// measures characters, not bytes.
	if err := validateDevNullText(strings.Repeat("é", providerlimits.DevNullMaxBodyCharacters)); err != nil {
		t.Fatalf("4000 characters rejected: %v", err)
	}
	if err := validateDevNullText(strings.Repeat("é", providerlimits.DevNullMaxBodyCharacters+1)); err == nil {
		t.Fatal("expected 4001 characters to fail")
	}
}
