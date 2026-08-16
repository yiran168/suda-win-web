; 素打 · 安装程序脚本（NSIS 3，Unicode）
Unicode true
!include "MUI2.nsh"

Name "素打"
OutFile "..\release\素打-安装程序.exe"
InstallDir "$LOCALAPPDATA\Programs\素打"
RequestExecutionLevel user
Icon "..\assets\icon.ico"
UninstallIcon "..\assets\icon.ico"

!define MUI_ICON "..\assets\icon.ico"
!define MUI_UNICON "..\assets\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\素打.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动素打"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\release\qrint-portable\*.*"

  CreateDirectory "$SMPROGRAMS\素打"
  CreateShortcut "$SMPROGRAMS\素打\素打.lnk" "$INSTDIR\素打.exe" "" "$INSTDIR\素打.exe" 0
  CreateShortcut "$SMPROGRAMS\素打\卸载素打.lnk" "$INSTDIR\卸载素打.exe"
  CreateShortcut "$DESKTOP\素打.lnk" "$INSTDIR\素打.exe" "" "$INSTDIR\素打.exe" 0

  WriteUninstaller "$INSTDIR\卸载素打.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QrintStudio" "DisplayName" "素打"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QrintStudio" "DisplayIcon" "$INSTDIR\素打.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QrintStudio" "UninstallString" "$INSTDIR\卸载素打.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QrintStudio" "Publisher" "Qrint Studio"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QrintStudio" "DisplayVersion" "1.0.0"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QrintStudio" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QrintStudio" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\素打.lnk"
  Delete "$SMPROGRAMS\素打\素打.lnk"
  Delete "$SMPROGRAMS\素打\卸载素打.lnk"
  RMDir "$SMPROGRAMS\素打"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QrintStudio"
SectionEnd
