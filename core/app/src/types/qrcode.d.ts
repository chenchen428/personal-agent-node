declare module "qrcode" {
  const QRCode: { toDataURL(value: string, options?: Record<string, unknown>): Promise<string> };
  export default QRCode;
}
