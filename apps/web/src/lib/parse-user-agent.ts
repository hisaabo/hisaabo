export interface ParsedUA {
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet";
}

export function parseUserAgent(ua: string | null): ParsedUA {
  if (!ua) return { browser: "Unknown", os: "Unknown", deviceType: "desktop" };

  // Browser detection (order matters — check specific before generic)
  let browser = "Unknown browser";
  const edgeMatch = ua.match(/Edg\/(\d+)/);
  const operaMatch = ua.match(/OPR\/(\d+)/);
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const safariVersionMatch = ua.match(/Version\/(\d+)/);
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);

  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (operaMatch) browser = `Opera ${operaMatch[1]}`;
  else if (chromeMatch && !ua.includes("Edg/") && !ua.includes("OPR/")) browser = `Chrome ${chromeMatch[1]}`;
  else if (ua.includes("Safari/") && safariVersionMatch && !chromeMatch) browser = `Safari ${safariVersionMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;

  // OS detection
  let os = "Unknown OS";
  if (ua.includes("Windows NT")) os = "Windows";
  else if (ua.includes("Mac OS X")) os = "macOS";
  else if (ua.includes("CrOS")) os = "ChromeOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Linux")) os = "Linux";

  // Device type
  let deviceType: ParsedUA["deviceType"] = "desktop";
  if (/Mobile|Android.*Mobile/i.test(ua)) deviceType = "mobile";
  else if (/Tablet|iPad/i.test(ua)) deviceType = "tablet";

  return { browser, os, deviceType };
}
