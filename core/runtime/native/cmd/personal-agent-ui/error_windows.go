//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

func showError(message string) {
	text, _ := syscall.UTF16PtrFromString(message)
	title, _ := syscall.UTF16PtrFromString("Personal Agent")
	messageBox := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	_, _, _ = messageBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
}
