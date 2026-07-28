package main

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type diagnosticRecord struct {
	Platform    string `json:"platform"`
	InstanceURL string `json:"instance_url"`
	ExternalID  string `json:"external_id"`
	TokenHex    string `json:"token_hex"`
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		fmt.Fprintln(os.Stderr, "missing encryption key")
		os.Exit(1)
	}
	key := strings.TrimSpace(scanner.Text())
	for scanner.Scan() {
		var record diagnosticRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			fmt.Printf("%s input_error=%v\n", record.Platform, err)
			continue
		}
		token, err := decryptToken(key, record.TokenHex)
		if err != nil {
			fmt.Printf("%s decrypt_error=%v\n", record.Platform, err)
			continue
		}
		status, code, message, err := checkProvider(record, token)
		if err != nil {
			fmt.Printf("%s request_error=%v\n", record.Platform, err)
			continue
		}
		fmt.Printf("%s http=%d code=%q message=%q\n", record.Platform, status, code, message)
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func decryptToken(masterKey, ciphertextHex string) (string, error) {
	ciphertext, err := hex.DecodeString(ciphertextHex)
	if err != nil {
		return "", err
	}
	key := sha256.Sum256([]byte(masterKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}
	plaintext, err := gcm.Open(nil, ciphertext[:nonceSize], ciphertext[nonceSize:], nil)
	return string(plaintext), err
}

func checkProvider(record diagnosticRecord, token string) (int, string, string, error) {
	var endpoint string
	headers := map[string]string{}
	switch record.Platform {
	case "threads":
		fields := url.QueryEscape("id,text,username,timestamp,hide_status")
		endpoint = "https://graph.threads.net/v1.0/" + url.PathEscape(record.ExternalID) + "/replies?fields=" + fields + "&access_token=" + url.QueryEscape(token)
	case "linkedin":
		endpoint = "https://api.linkedin.com/rest/socialActions/" + url.QueryEscape(record.ExternalID) + "/comments"
		headers["Authorization"] = "Bearer " + token
		headers["Linkedin-Version"] = time.Now().UTC().AddDate(0, -1, 0).Format("200601")
		headers["X-Restli-Protocol-Version"] = "2.0.0"
	default:
		return 0, "", "", fmt.Errorf("unsupported provider %q", record.Platform)
	}
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, "", "", err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, "", "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return 0, "", "", err
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return resp.StatusCode, "", string(body), nil
	}
	code, message := safeError(payload)
	return resp.StatusCode, code, message, nil
}

func safeError(payload map[string]any) (string, string) {
	code := fmt.Sprint(payload["code"])
	message := fmt.Sprint(payload["message"])
	if nested, ok := payload["error"].(map[string]any); ok {
		if value := fmt.Sprint(nested["code"]); value != "<nil>" {
			code = value
		}
		if value := fmt.Sprint(nested["message"]); value != "<nil>" {
			message = value
		}
	}
	if code == "<nil>" {
		code = ""
	}
	if message == "<nil>" {
		message = ""
	}
	if len(message) > 500 {
		message = message[:500]
	}
	return code, message
}
