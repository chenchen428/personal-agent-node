import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workspaceRoot } from "./config.ts";

export const windowsServiceId = "PrivateSiteNode";

export function prepareWindowsService(config, options = {}) {
  if ((options.platform || process.platform) !== "win32") throw new Error("The Windows task lifecycle is Windows-only");
  const taskDir = path.join(config.dataRoot, "runtime", "windows-task");
  fs.mkdirSync(taskDir, { recursive: true, mode: 0o700 });
  const taskXmlPath = path.join(taskDir, `${windowsServiceId}.xml`);
  const cliPath = options.cliPath || path.join(workspaceRoot, "core", "runtime", "bin", "private-site.mjs");
  const userId = options.userId || windowsUserId();
  fs.writeFileSync(taskXmlPath, renderWindowsScheduledTask(config, {
    cliPath,
    nodePath: options.nodePath || process.execPath,
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

export function renderWindowsScheduledTask(config, { cliPath, nodePath = process.execPath, userId } = {}) {
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
      <Command>${xmlEscape(nodePath)}</Command>
      <Arguments>&quot;${xmlEscape(cliPath)}&quot; start --data-root &quot;${xmlEscape(config.dataRoot)}&quot;</Arguments>
      <WorkingDirectory>${xmlEscape(workspaceRoot)}</WorkingDirectory>
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
