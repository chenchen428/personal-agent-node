Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef BOOTSTRAP
  !error "BOOTSTRAP is required"
!endif
!ifndef OUTFILE
  !error "OUTFILE is required"
!endif
!ifndef PRODUCT_VERSION
  !error "PRODUCT_VERSION is required"
!endif
!ifndef PRODUCT_FILE_VERSION
  !error "PRODUCT_FILE_VERSION is required"
!endif
!ifndef PRODUCT_ICON
  !error "PRODUCT_ICON is required"
!endif
!ifndef LICENSE_FILE
  !error "LICENSE_FILE is required"
!endif

Name "Personal Agent"
Caption "Personal Agent 安装向导"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Personal Agent"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "InstallLocation"
Icon "${PRODUCT_ICON}"
UninstallIcon "${PRODUCT_ICON}"
BrandingText "Personal Agent ${PRODUCT_VERSION}"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${PRODUCT_FILE_VERSION}"
VIAddVersionKey /LANG=2052 "ProductName" "Personal Agent"
VIAddVersionKey /LANG=2052 "FileDescription" "Personal Agent 安装向导"
VIAddVersionKey /LANG=2052 "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Personal Agent contributors"

!define MUI_ABORTWARNING
!define MUI_ICON "${PRODUCT_ICON}"
!define MUI_UNICON "${PRODUCT_ICON}"
!define MUI_WELCOMEPAGE_TITLE "安装 Personal Agent"
!define MUI_WELCOMEPAGE_TEXT "此向导将安装一个完整的 Personal Agent 桌面应用。$\r$\n$\r$\n应用自带所需的 Node.js 后台能力，不会另外安装独立服务；完成后会在开始菜单和桌面创建程序图标，并打开本机 Setup Center。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE_FILE}"
!define MUI_DIRECTORYPAGE_TEXT_TOP "请选择 Personal Agent 程序文件的安装目录。Workspace 数据仍保存在当前用户目录中，卸载程序也不会删除这些数据。"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Personal Agent 已安装"
!define MUI_FINISHPAGE_TEXT "Personal Agent 桌面应用已经就绪。首次启动时，应用会在内部启动本机后台并打开 Setup Center。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\core\bin\personal-agent-ui.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 Personal Agent"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Var TestHome
Var InstallArgs
Var ExistingInstallDir

Function .onInit
  ReadEnvStr $TestHome "PERSONAL_AGENT_INSTALL_TEST_HOME"
  ${If} $TestHome != ""
    StrCpy $INSTDIR "$TestHome\program"
    StrCpy $InstallArgs 'install --install-root "$INSTDIR\core" --data-root "$TestHome\workspace" --desktop-managed --no-open --skip-start-wait --desktop-entry-root "$TestHome\desktop-entries"'
  ${Else}
    ReadRegStr $ExistingInstallDir HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "InstallLocation"
    ${If} $ExistingInstallDir == ""
      IfFileExists "$PROFILE\.personal-agent\core\installation.json" 0 +2
      StrCpy $INSTDIR "$PROFILE\.personal-agent"
    ${EndIf}
    StrCpy $InstallArgs 'install --install-root "$INSTDIR\core" --data-root "$PROFILE\.personal-agent\workspace" --desktop-managed --no-open'
  ${EndIf}
FunctionEnd

Section "Personal Agent" MainSection
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /oname=personal-agent-setup.exe "${BOOTSTRAP}"

  DetailPrint "正在验证安装包并准备不可变发行版…"
  nsExec::ExecToStack '"$INSTDIR\personal-agent-setup.exe" $InstallArgs'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    DetailPrint "$1"
    ${If} $TestHome == ""
      IfSilent silent_install_error
      MessageBox MB_OK|MB_ICONSTOP "Personal Agent 安装未完成。$\r$\n$\r$\n$1$\r$\n$\r$\n请关闭正在运行的旧版或开发服务后重试；已有 Workspace 数据不会被删除。"
      SetErrorLevel $0
      Abort
      silent_install_error:
      SetErrorLevel $0
      Quit
    ${EndIf}
    SetErrorLevel $0
    Abort
  ${EndIf}

  ${If} $TestHome == ""
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "DisplayName" "Personal Agent"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "DisplayVersion" "${PRODUCT_VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "DisplayIcon" "$INSTDIR\core\bin\personal-agent.ico"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "Publisher" "Personal Agent"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent" "NoRepair" 1
  ${EndIf}
SectionEnd

Section "Uninstall"
  DetailPrint "正在移除 Personal Agent 程序文件；Workspace 数据将保留。"
  nsExec::ExecToStack '"$INSTDIR\personal-agent-setup.exe" uninstall --install-root "$INSTDIR\core" --confirm-remove-binaries'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    DetailPrint "$1"
    IfSilent silent_uninstall_error
    MessageBox MB_OK|MB_ICONSTOP "卸载未完成。$\r$\n$\r$\n$1"
    SetErrorLevel $0
    Abort
    silent_uninstall_error:
    SetErrorLevel $0
    Quit
  ${EndIf}
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalAgent"
  Delete "$INSTDIR\personal-agent-setup.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
