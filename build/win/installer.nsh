!include "LogicLib.nsh"
!include "WinMessages.nsh"

!macro customInstall
  Push $0
  Push $1
  Push $2

  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  ${If} $0 == ""
    StrCpy $0 "$INSTDIR"
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0"
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${Else}
    StrLen $1 "$INSTDIR"
    IntOp $1 $1 + 1
    StrCpy $2 $0 $1 -$1
    ${If} $0 != "$INSTDIR"
    ${AndIf} $2 != ";$INSTDIR"
      StrCpy $0 "$0;$INSTDIR"
      WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0"
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
    ${EndIf}
  ${EndIf}

  SearchPath $1 "sclang.exe"
  ${If} $1 == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "Spaluter Desktop installed, but SuperCollider (sclang.exe) was not found in PATH.$\r$\nInstall SuperCollider or set SCLANG_PATH before launching the app."
  ${EndIf}

  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  ; Keep PATH cleanup explicit/manual to avoid accidental truncation on uninstall.
!macroend
