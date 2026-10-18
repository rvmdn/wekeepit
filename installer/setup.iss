; Inno Setup Script for WeKeepIt V2
; Generates a clean, modern Windows Installer: WeKeepIt-v2.0.0-Setup.exe

#define MyAppName "WeKeepIt"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Antigravity"
#define MyAppURL "https://github.com/rvmdn/wekeepit"
#define MyAppExeName "WeKeepIt.exe"
#define MyAppMutex "WeKeepIt_Desktop_App_Mutex_v2"

[Setup]
; Unique AppId GUID for WeKeepIt
AppId={{9F6D6BC4-893C-4C82-96BE-2A86299DE1A0}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases

; Default install to LocalAppData (Per-User: No UAC elevation required, seamless upgrades)
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; Output configuration
OutputDir=..\dist
OutputBaseFilename=WeKeepIt-v{#MyAppVersion}-Setup
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

; Mutex check & smooth close on update
AppMutex={#MyAppMutex}
CloseApplications=yes
CloseApplicationsFilter=*WeKeepIt*

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupicon"; Description: "Jalankan WeKeepIt otomatis saat Windows menyala"; GroupDescription: "Preferensi Startup:"; Flags: unchecked

[Files]
; All published application files
Source: "..\package\app-files\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Seed sample data to AppData ONLY if user doesn't already have one (Preserves existing notes on update!)
Source: "..\wekeepit-data.sample.json"; DestDir: "{userappdata}\{#MyAppName}"; DestName: "wekeepit-data.json"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startupicon

[Run]
Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Filename: "{app}\{#MyAppExeName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean WebView2 profile cache on uninstall, but user data in AppData is preserved
Type: filesandordirs; Name: "{localappdata}\{#MyAppName}\WebView2Profile"
