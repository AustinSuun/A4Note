!include "LogicLib.nsh"
; Per-user install. Windows resolves the host executable relative to this manifest.
!macro NSIS_HOOK_POSTINSTALL
  SetRegView 32
  ClearErrors
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\app.aster.research.capture" "" "$INSTDIR\native-host\app.aster.research.capture.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\app.aster.research.capture" "" "$INSTDIR\native-host\app.aster.research.capture.json"
  SetRegView 64
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\app.aster.research.capture" "" "$INSTDIR\native-host\app.aster.research.capture.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\app.aster.research.capture" "" "$INSTDIR\native-host\app.aster.research.capture.json"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "A4 Note browser connection registration failed. Please repair the installation."
    Abort
  ${EndIf}
!macroend
!macro A4_REMOVE_OWN_HOST BROWSER
  ReadRegStr $0 HKCU "Software\${BROWSER}\NativeMessagingHosts\app.aster.research.capture" ""
  ${If} $0 == "$INSTDIR\native-host\app.aster.research.capture.json"
    DeleteRegKey HKCU "Software\${BROWSER}\NativeMessagingHosts\app.aster.research.capture"
  ${EndIf}
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  Push $0
  SetRegView 32
  !insertmacro A4_REMOVE_OWN_HOST "Google\Chrome"
  !insertmacro A4_REMOVE_OWN_HOST "Microsoft\Edge"
  SetRegView 64
  !insertmacro A4_REMOVE_OWN_HOST "Google\Chrome"
  !insertmacro A4_REMOVE_OWN_HOST "Microsoft\Edge"
  Pop $0
!macroend
