import fs from 'node:fs';
import os from 'node:os';

export function readServerCapacity({ rootPath = '/', osModule = os, statfs = fs.statfsSync } = {}) {
  const memoryTotalBytes = Number(osModule.totalmem()) || 0;
  const memoryAvailableBytes = Math.max(Number(osModule.freemem()) || 0, 0);
  const cpuCount = Math.max(osModule.cpus()?.length || 1, 1);
  const cpuLoad1 = Math.max(Number(osModule.loadavg()?.[0]) || 0, 0);
  const disk = statfs(rootPath);
  const blockSize = Number(disk.bsize) || 0;
  const diskTotalBytes = blockSize * (Number(disk.blocks) || 0);
  const diskAvailableBytes = blockSize * (Number(disk.bavail) || 0);
  const inodeTotal = Number(disk.files) || 0;
  const inodeAvailable = Number(disk.ffree) || 0;
  return {
    generatedAt: new Date().toISOString(),
    cpu: {
      cores: cpuCount,
      load1: round(cpuLoad1, 2),
      loadPercent: percent(cpuLoad1, cpuCount),
    },
    memory: {
      totalBytes: memoryTotalBytes,
      usedBytes: Math.max(memoryTotalBytes - memoryAvailableBytes, 0),
      availableBytes: memoryAvailableBytes,
      usedPercent: percent(memoryTotalBytes - memoryAvailableBytes, memoryTotalBytes),
    },
    disk: {
      path: rootPath,
      totalBytes: diskTotalBytes,
      usedBytes: Math.max(diskTotalBytes - diskAvailableBytes, 0),
      availableBytes: diskAvailableBytes,
      usedPercent: percent(diskTotalBytes - diskAvailableBytes, diskTotalBytes),
      inodeUsedPercent: inodeTotal ? percent(inodeTotal - inodeAvailable, inodeTotal) : 0,
    },
  };
}

export function evaluateCapacityIssues(capacity, thresholds = {}) {
  const diskUsedPercent = Number(thresholds.diskUsedPercent ?? 92);
  const diskAvailableBytes = Number(thresholds.diskAvailableBytes ?? 5 * 1024 ** 3);
  const inodeUsedPercent = Number(thresholds.inodeUsedPercent ?? 95);
  const memoryUsedPercent = Number(thresholds.memoryUsedPercent ?? 95);
  const memoryAvailableBytes = Number(thresholds.memoryAvailableBytes ?? 512 * 1024 ** 2);
  const cpuLoadPercent = Number(thresholds.cpuLoadPercent ?? 150);
  const issues = [];
  if (capacity.disk.usedPercent >= diskUsedPercent || (capacity.disk.usedPercent >= 85 && capacity.disk.availableBytes <= diskAvailableBytes)) {
    issues.push({ key: 'disk', label: '磁盘容量', value: `${capacity.disk.usedPercent}% 已用，剩余 ${formatCapacity(capacity.disk.availableBytes)}` });
  }
  if (capacity.disk.inodeUsedPercent >= inodeUsedPercent) {
    issues.push({ key: 'inode', label: '磁盘文件数', value: `${capacity.disk.inodeUsedPercent}% 已用` });
  }
  if (capacity.memory.usedPercent >= memoryUsedPercent && capacity.memory.availableBytes <= memoryAvailableBytes) {
    issues.push({ key: 'memory', label: '内存容量', value: `${capacity.memory.usedPercent}% 已用，剩余 ${formatCapacity(capacity.memory.availableBytes)}` });
  }
  if (capacity.cpu.loadPercent >= cpuLoadPercent) {
    issues.push({ key: 'cpu', label: 'CPU 持续负载', value: `${capacity.cpu.loadPercent}%（${capacity.cpu.cores} 核）` });
  }
  return issues;
}

export function capacityState(capacity) {
  const issues = evaluateCapacityIssues(capacity);
  if (issues.length) return 'critical';
  if (capacity.disk.usedPercent >= 80 || capacity.memory.usedPercent >= 85 || capacity.cpu.loadPercent >= 100) return 'warning';
  return 'healthy';
}

export function formatCapacity(bytes) {
  const value = Math.max(Number(bytes) || 0, 0);
  if (value >= 1024 ** 3) return `${round(value / 1024 ** 3, 1)} GB`;
  if (value >= 1024 ** 2) return `${round(value / 1024 ** 2, 0)} MB`;
  return `${round(value / 1024, 0)} KB`;
}

function percent(used, total) {
  return total > 0 ? Math.min(Math.max(Math.round((used / total) * 100), 0), 999) : 0;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}
