package main

import (
	"fmt"

	"github.com/openpost/backend/internal/platform"
)

func main() {
	fmt.Println("Import works")
	var _ platform.TokenResult // This should work if imported correctly
}
