!include "LogicLib.nsh"
!include "WinMessages.nsh"

!macro customInstall
  Push $0
  Push $1

  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"

  ${If} $0 == ""
    StrCpy $1 "$INSTDIR"
  ${Else}
    StrCpy $1 "$0;$INSTDIR"
  ${EndIf}

  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$1"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  ; Keep PATH cleanup explicit/manual to avoid accidental truncation on uninstall.
!macroend
