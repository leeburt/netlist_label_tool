/** 与图片同目录、同主文件名的网表 JSON 相对路径（相对服务器工作区根目录） */
export function imageRelPathToJsonRelPath(imageRel: string): string {
  const dot = imageRel.lastIndexOf('.');
  const base = dot >= 0 ? imageRel.slice(0, dot) : imageRel;
  return `${base}.json`;
}
