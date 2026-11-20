@echo off
setlocal DisableDelayedExpansion
set "signTool=%STITCH_DESKTOP_WINDOWS_SIGNTOOL%"
set "certificateFile=%STITCH_DESKTOP_WINDOWS_CER_FILE%"
set "tokenPin=%STITCH_DESKTOP_WINDOWS_TOKEN_PIN%"
set "keyContainer=%STITCH_DESKTOP_WINDOWS_KEY_CONTAINER%"
set "targetFile=%STITCH_DESKTOP_WINDOWS_SIGN_TARGET%"
set "appendSignature="
if "%STITCH_DESKTOP_WINDOWS_SIGN_APPEND%"=="1" set "appendSignature=/as"
set "STITCH_DESKTOP_WINDOWS_SIGNTOOL="
set "STITCH_DESKTOP_WINDOWS_CER_FILE="
set "STITCH_DESKTOP_WINDOWS_TOKEN_PIN="
set "STITCH_DESKTOP_WINDOWS_KEY_CONTAINER="
set "STITCH_DESKTOP_WINDOWS_SIGN_TARGET="
set "STITCH_DESKTOP_WINDOWS_SIGN_APPEND="
set "signTool=" & set "certificateFile=" & set "tokenPin=" & set "keyContainer=" & set "targetFile=" & set "appendSignature=" & "%signTool%" sign /v /fd sha256 /f "%certificateFile%" /kc "[{{%tokenPin%}}]=%keyContainer%" /csp "eToken Base Cryptographic Provider" %appendSignature% "%targetFile%"
exit /b %errorlevel%
