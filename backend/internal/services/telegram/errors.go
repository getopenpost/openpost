package telegram

type ErrorCode string

const (
	CodeProviderUnavailable     ErrorCode = "telegram_provider_unavailable"
	CodeInvalidUpdate           ErrorCode = "telegram_invalid_update"
	CodeUnsupportedChat         ErrorCode = "telegram_unsupported_chat"
	CodeChatIdentityMismatch    ErrorCode = "telegram_chat_identity_mismatch"
	CodeBotNotMember            ErrorCode = "telegram_bot_not_member"
	CodeInsufficientPermissions ErrorCode = "telegram_insufficient_permissions"
	CodeChatAlreadyConnected    ErrorCode = "telegram_chat_already_connected"
	CodePersistenceFailed       ErrorCode = "telegram_connection_failed"
	CodePublishAmbiguous        ErrorCode = "telegram_publish_ambiguous"
	CodeInvalidPublish          ErrorCode = "telegram_invalid_publish"
)

type SafeError struct {
	code ErrorCode
}

func (err *SafeError) Error() string    { return string(err.code) }
func (err *SafeError) SafeCode() string { return string(err.code) }

var (
	ErrProviderUnavailable     = &SafeError{code: CodeProviderUnavailable}
	ErrInvalidUpdate           = &SafeError{code: CodeInvalidUpdate}
	ErrUnsupportedChat         = &SafeError{code: CodeUnsupportedChat}
	ErrChatIdentityMismatch    = &SafeError{code: CodeChatIdentityMismatch}
	ErrBotNotMember            = &SafeError{code: CodeBotNotMember}
	ErrInsufficientPermissions = &SafeError{code: CodeInsufficientPermissions}
	ErrChatAlreadyConnected    = &SafeError{code: CodeChatAlreadyConnected}
	ErrPersistenceFailed       = &SafeError{code: CodePersistenceFailed}
	ErrPublishAmbiguous        = &SafeError{code: CodePublishAmbiguous}
	ErrInvalidPublish          = &SafeError{code: CodeInvalidPublish}
)
