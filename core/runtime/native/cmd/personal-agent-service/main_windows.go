//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const (
	createNoWindow                    = 0x08000000
	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x00002000
)

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	createJobObjectW         = kernel32.NewProc("CreateJobObjectW")
	setInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	assignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	closeHandle              = kernel32.NewProc("CloseHandle")
)

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type basicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type extendedLimitInformation struct {
	BasicLimitInformation basicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

func main() {
	installRoot, dataRoot, current, err := resolveRuntime()
	logFile := openLog(dataRoot)
	if logFile != nil {
		defer logFile.Close()
	}
	if err != nil {
		fail(logFile, err)
	}

	job, err := createKillOnCloseJob()
	if err != nil {
		fail(logFile, fmt.Errorf("create service process group: %w", err))
	}
	defer closeHandle.Call(uintptr(job))
	if err := assignCurrentProcess(job); err != nil {
		fail(logFile, fmt.Errorf("isolate service process group: %w", err))
	}

	node := filepath.Join(current, "runtime", "node.exe")
	entrypoint := filepath.Join(current, "core", "runtime", "bin", "private-site.mjs")
	command := exec.Command(node, entrypoint, "start", "--data-root", dataRoot)
	command.Dir = current
	command.Env = append(os.Environ(),
		"PERSONAL_AGENT_HOME="+filepath.Dir(installRoot),
		"PRIVATE_SITE_INSTALL_ROOT="+installRoot,
		"PRIVATE_SITE_DATA_ROOT="+dataRoot,
		"PRIVATE_SITE_CLI_BIN="+filepath.Join(installRoot, "bin"),
	)
	command.Stdout = logFile
	command.Stderr = logFile
	command.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
	if err := command.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			os.Exit(exit.ExitCode())
		}
		fail(logFile, fmt.Errorf("run Personal Agent service: %w", err))
	}
}

func resolveRuntime() (installRoot, dataRoot, current string, err error) {
	executable, err := os.Executable()
	if err != nil {
		return "", "", "", err
	}
	installRoot = os.Getenv("PRIVATE_SITE_INSTALL_ROOT")
	if installRoot == "" {
		installRoot = filepath.Dir(filepath.Dir(executable))
	}
	dataRoot = dataRootArgument(os.Args[1:])
	if dataRoot == "" {
		dataRoot = os.Getenv("PRIVATE_SITE_DATA_ROOT")
	}
	if dataRoot == "" {
		homeRoot := os.Getenv("PERSONAL_AGENT_HOME")
		if homeRoot == "" {
			home, homeErr := os.UserHomeDir()
			if homeErr != nil {
				return "", "", "", homeErr
			}
			homeRoot = filepath.Join(home, ".personal-agent")
		}
		dataRoot = filepath.Join(homeRoot, "workspace")
	}
	current, err = resolveCurrent(filepath.Join(installRoot, "current"))
	return installRoot, dataRoot, current, err
}

func dataRootArgument(args []string) string {
	for index := 0; index < len(args); index++ {
		if args[index] == "--data-root" && index+1 < len(args) {
			return filepath.Clean(args[index+1])
		}
	}
	return ""
}

func resolveCurrent(pointer string) (string, error) {
	if target, err := filepath.EvalSymlinks(pointer); err == nil {
		if info, statErr := os.Stat(target); statErr == nil && info.IsDir() {
			return target, nil
		}
	}
	data, err := os.ReadFile(pointer)
	if err != nil || len(data) > 4096 {
		return "", fmt.Errorf("invalid active release pointer")
	}
	target := filepath.Clean(strings.TrimSpace(string(data)))
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("invalid active release target")
	}
	return target, nil
}

func openLog(dataRoot string) *os.File {
	if dataRoot == "" {
		return nil
	}
	logsDir := filepath.Join(dataRoot, "logs")
	if os.MkdirAll(logsDir, 0o700) != nil {
		return nil
	}
	file, err := os.OpenFile(filepath.Join(logsDir, "windows-service-host.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil
	}
	return file
}

func createKillOnCloseJob() (syscall.Handle, error) {
	handle, _, callErr := createJobObjectW.Call(0, 0)
	if handle == 0 {
		return 0, callErr
	}
	job := syscall.Handle(handle)
	info := extendedLimitInformation{}
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	ok, _, callErr := setInformationJobObject.Call(
		handle,
		jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		unsafe.Sizeof(info),
	)
	if ok == 0 {
		closeHandle.Call(handle)
		return 0, callErr
	}
	return job, nil
}

func assignCurrentProcess(job syscall.Handle) error {
	process, err := syscall.GetCurrentProcess()
	if err != nil {
		return err
	}
	ok, _, callErr := assignProcessToJobObject.Call(uintptr(job), uintptr(process))
	if ok == 0 {
		return callErr
	}
	return nil
}

func fail(logFile *os.File, err error) {
	if logFile != nil {
		_, _ = fmt.Fprintln(logFile, err)
	}
	os.Exit(1)
}
