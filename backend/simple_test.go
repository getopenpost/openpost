package main

import (
	"fmt"
	"testing"

	"github.com/openpost/backend/internal/platform"
)

func TestPlatformImport(_ *testing.T) {
	var _ platform.TokenResult
	fmt.Println("Platform import works")
}
