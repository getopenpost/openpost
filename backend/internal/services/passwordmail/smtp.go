package passwordmail

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

const defaultTimeout = 15 * time.Second

type ResetMessage struct {
	Recipient string
	ResetURL  string
	ExpiresAt time.Time
}

type Sender interface {
	SendPasswordReset(context.Context, ResetMessage) error
}

type SMTPConfig struct {
	Host       string
	Port       int
	Username   string
	Password   string
	From       string
	TLSMode    string
	ServerName string
	Timeout    time.Duration
}

type SMTPSender struct {
	config SMTPConfig
	from   *mail.Address
}

func NewSMTPSender(config SMTPConfig) (*SMTPSender, error) {
	config = normalizeSMTPConfig(config)
	if err := validateSMTPConfig(config); err != nil {
		return nil, err
	}
	from, err := mail.ParseAddress(config.From)
	if err != nil {
		return nil, fmt.Errorf("invalid SMTP from address: %w", err)
	}
	return &SMTPSender{config: config, from: from}, nil
}

func normalizeSMTPConfig(config SMTPConfig) SMTPConfig {
	config.Host = strings.TrimSpace(config.Host)
	config.Username = strings.TrimSpace(config.Username)
	config.From = strings.TrimSpace(config.From)
	config.TLSMode = strings.ToLower(strings.TrimSpace(config.TLSMode))
	config.ServerName = strings.TrimSpace(config.ServerName)
	if config.TLSMode == "" {
		config.TLSMode = "starttls"
	}
	if config.ServerName == "" {
		config.ServerName = config.Host
	}
	if config.Timeout <= 0 {
		config.Timeout = defaultTimeout
	}
	return config
}

func validateSMTPConfig(config SMTPConfig) error {
	if config.Host == "" {
		return errors.New("SMTP host is required")
	}
	if config.Port <= 0 || config.Port > 65535 {
		return errors.New("SMTP port must be between 1 and 65535")
	}
	if config.From == "" {
		return errors.New("SMTP from address is required")
	}
	if config.TLSMode != "starttls" && config.TLSMode != "tls" && config.TLSMode != "none" {
		return errors.New("SMTP TLS mode must be starttls, tls, or none")
	}
	if config.TLSMode == "none" && !isLoopbackHost(config.Host) {
		return errors.New("unencrypted SMTP is allowed only for loopback hosts")
	}
	if config.Username != "" && config.Password == "" {
		return errors.New("SMTP password is required when a username is configured")
	}
	return nil
}

func (s *SMTPSender) SendPasswordReset(ctx context.Context, message ResetMessage) error {
	recipient, err := mail.ParseAddress(strings.TrimSpace(message.Recipient))
	if err != nil {
		return fmt.Errorf("invalid password reset recipient: %w", err)
	}
	if strings.TrimSpace(message.ResetURL) == "" {
		return errors.New("password reset URL is required")
	}

	client, conn, err := s.connect(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	defer client.Close()

	if s.config.Username != "" {
		if ok, _ := client.Extension("AUTH"); !ok {
			return errors.New("SMTP server does not advertise AUTH")
		}
		auth := smtp.PlainAuth("", s.config.Username, s.config.Password, s.config.ServerName)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("authenticate with SMTP server: %w", err)
		}
	}
	if err := client.Mail(s.from.Address); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err := client.Rcpt(recipient.Address); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("start SMTP message: %w", err)
	}
	if _, err := w.Write(buildResetEmail(s.from, recipient, message)); err != nil {
		_ = w.Close()
		return fmt.Errorf("write SMTP message: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("finish SMTP message: %w", err)
	}
	if err := client.Quit(); err != nil {
		return fmt.Errorf("finish SMTP session: %w", err)
	}
	return nil
}

func (s *SMTPSender) connect(ctx context.Context) (*smtp.Client, net.Conn, error) {
	address := net.JoinHostPort(s.config.Host, strconv.Itoa(s.config.Port))
	dialer := &net.Dialer{Timeout: s.config.Timeout}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, nil, fmt.Errorf("connect to SMTP server: %w", err)
	}
	deadline := time.Now().Add(s.config.Timeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	if err := conn.SetDeadline(deadline); err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("set SMTP deadline: %w", err)
	}

	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: s.config.ServerName}
	if s.config.TLSMode == "tls" {
		tlsConn := tls.Client(conn, tlsConfig)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			conn.Close()
			return nil, nil, fmt.Errorf("negotiate SMTP TLS: %w", err)
		}
		conn = tlsConn
	}

	client, err := smtp.NewClient(conn, s.config.ServerName)
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("start SMTP client: %w", err)
	}
	if s.config.TLSMode == "starttls" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			client.Close()
			conn.Close()
			return nil, nil, errors.New("SMTP server does not advertise STARTTLS")
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			client.Close()
			conn.Close()
			return nil, nil, fmt.Errorf("negotiate SMTP STARTTLS: %w", err)
		}
	}
	return client, conn, nil
}

func buildResetEmail(from, recipient *mail.Address, message ResetMessage) []byte {
	expires := message.ExpiresAt.UTC().Format(time.RFC1123)
	body := "A password reset was requested for your OpenPost account.\r\n\r\n" +
		"Open this link to choose a new password:\r\n" + message.ResetURL + "\r\n\r\n" +
		"This single-use link expires at " + expires + ".\r\n" +
		"If you did not request this change, you can ignore this email.\r\n"

	return []byte(fmt.Sprintf(
		"Date: %s\r\nFrom: %s\r\nTo: %s\r\nSubject: Reset your OpenPost password\r\n"+
			"MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n"+
			"Content-Transfer-Encoding: 8bit\r\n\r\n%s",
		time.Now().UTC().Format(time.RFC1123Z), from.String(), recipient.String(), body,
	))
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}
