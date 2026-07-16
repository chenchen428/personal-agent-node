import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const windowsServiceId = "PrivateSiteNode";

export function prepareWindowsService(config, options = {}) {
  if ((options.platform || process.platform) !== "win32") throw new Error("The Windows task lifecycle is Windows-only");
  const taskDir = path.join(config.dataRoot, "runtime", "windows-task");
  fs.mkdirSync(taskDir, { recursive: true, mode: 0o700 });
  const taskXmlPath = path.join(taskDir, `${windowsServiceId}.xml`);
  const installRoot = options.installRoot || process.env.PRIVATE_SITE_INSTALL_ROOT || path.join(config.homeRoot, "core");
  const servicePath = options.servicePath || path.join(installRoot, "bin", "personal-agent-service.exe");
  const userId = options.userId || windowsUserId();
  fs.writeFileSync(taskXmlPath, renderWindowsScheduledTask(config, {
    servicePath,
    userId,
  }), "utf8");
  return {
    ok: true,
    platform: "win32",
    serviceId: windowsServiceId,
    taskName: windowsServiceId,
    taskXmlPath,
    userId,
    installCommand: `schtasks /Create /TN "${windowsServiceId}" /XML "${taskXmlPath}" /F`,
  };
}

export function renderWindowsScheduledTask(config, { servicePath, userId } = {}) {
  if (!servicePath) throw new Error("The Windows background service host path is required");
  return `<?xml version="1.0"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Local-first complete Site runtime for ${xmlEscape(config.domain)}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xmlEscape(userId)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xmlEscape(userId)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>6</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(servicePath)}</Command>
      <Arguments>--data-root &quot;${xmlEscape(config.dataRoot)}&quot;</Arguments>
      <WorkingDirectory>${xmlEscape(path.dirname(servicePath))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

function windowsUserId() {
  const username = process.env.USERNAME || os.userInfo().username;
  const domain = process.env.USERDOMAIN;
  return domain ? `${domain}\\${username}` : username;
}

function xmlEscape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
