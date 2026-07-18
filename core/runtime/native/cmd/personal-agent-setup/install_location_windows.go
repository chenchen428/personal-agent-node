//go:build windows

package main

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"
)

const (
	bifReturnOnlyFSDirs = 0x0001
	bifEditBox          = 0x0010
	bifNewDialogStyle   = 0x0040
	bffmInitialized     = 1
	bffmSetSelectionW   = 0x0400 + 103
	coinitApartment     = 0x2
)

type browseInfo struct {
	owner       uintptr
	root        uintptr
	displayName *uint16
	title       *uint16
	flags       uint32
	callback    uintptr
	parameter   uintptr
	image       int32
}

var (
	shell32              = syscall.NewLazyDLL("shell32.dll")
	ole32                = syscall.NewLazyDLL("ole32.dll")
	user32               = syscall.NewLazyDLL("user32.dll")
	shBrowseForFolderW   = shell32.NewProc("SHBrowseForFolderW")
	shGetPathFromIDListW = shell32.NewProc("SHGetPathFromIDListW")
	coInitializeEx       = ole32.NewProc("CoInitializeEx")
	coUninitialize       = ole32.NewProc("CoUninitialize")
	coTaskMemFree        = ole32.NewProc("CoTaskMemFree")
	sendMessageW         = user32.NewProc("SendMessageW")
)

func selectInstallHome(defaultPath string) (string, bool, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	initialized, _, _ := coInitializeEx.Call(0, coinitApartment)
	if initialized == 0 || initialized == 1 {
		defer coUninitialize.Call()
	}
	title, err := syscall.UTF16PtrFromString("选择 Personal Agent 安装位置（程序和工作区都将保存在这里）")
	if err != nil {
		return "", false, err
	}
	initial, err := syscall.UTF16PtrFromString(defaultPath)
	if err != nil {
		return "", false, err
	}
	displayName := make([]uint16, 260)
	callback := syscall.NewCallback(func(window, message, _, parameter uintptr) uintptr {
		if message == bffmInitialized && parameter != 0 {
			sendMessageW.Call(window, bffmSetSelectionW, 1, parameter)
		}
		return 0
	})
	info := browseInfo{
		displayName: &displayName[0],
		title:       title,
		flags:       bifReturnOnlyFSDirs | bifEditBox | bifNewDialogStyle,
		callback:    callback,
		parameter:   uintptr(unsafe.Pointer(initial)),
	}
	item, _, callErr := shBrowseForFolderW.Call(uintptr(unsafe.Pointer(&info)))
	if item == 0 {
		if callErr != syscall.Errno(0) {
			return "", false, fmt.Errorf("open installation location picker: %w", callErr)
		}
		return "", false, nil
	}
	defer coTaskMemFree.Call(item)
	selected := make([]uint16, 32768)
	ok, _, pathErr := shGetPathFromIDListW.Call(item, uintptr(unsafe.Pointer(&selected[0])))
	if ok == 0 {
		if pathErr != syscall.Errno(0) {
			return "", false, fmt.Errorf("read installation location: %w", pathErr)
		}
		return "", false, fmt.Errorf("selected installation location is not a filesystem directory")
	}
	return syscall.UTF16ToString(selected), true, nil
}
