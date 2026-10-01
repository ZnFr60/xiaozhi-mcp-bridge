' 小智 MCP 桥接 - Windows 静默启动（零窗口）
' 权限绑定：以管理员身份运行此 VBS，则所有子进程继承管理员权限
' 用法：右键 → 以管理员身份运行（获得全机权限）
'       或直接双击（普通用户权限）

Option Explicit
Dim fso, shell, projDir, isAdmin

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 检测管理员权限
On Error Resume Next
isAdmin = False
Dim testKey
testKey = shell.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run\")
If Err.Number = 0 Then isAdmin = True
Err.Clear
On Error GoTo 0

' 如果不是管理员，自动提权重启
If Not isAdmin Then
    shell.ShellExecute "wscript.exe", """" & WScript.ScriptFullName & """", "", "runas", 0
    WScript.Quit
End If

' 停止旧 node 进程
shell.Run "taskkill /f /im node.exe", 0, True
WScript.Sleep 1000

' 静默启动 UI 面板（隐藏窗口）
shell.CurrentDirectory = projDir
shell.Run "node """ & projDir & "\server.js""", 0, False
WScript.Sleep 2000

' 静默启动桥接守护进程（隐藏窗口）
shell.Run "node """ & projDir & "\guardian.js""", 0, False

' 完成（无任何弹窗）
Set shell = Nothing
Set fso = Nothing
