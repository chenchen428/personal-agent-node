export async function downloadWechatQrPng(svg: string) {
  const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG unavailable")), "image/png"));
    const target = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = target;
    link.download = "personal-agent-wechat-login.png";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(target), 1000);
  } finally {
    URL.revokeObjectURL(source);
  }
}
