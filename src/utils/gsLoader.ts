import { GaussianData } from '../types';

/**
 * 加载 3DGS .ply 文件
 * @param url 文件路径
 * @returns Promise<GaussianData>
 */
export async function loadGaussianSplatting(url: string): Promise<GaussianData> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const dataView = new DataView(buffer);
  const uint8Array = new Uint8Array(buffer);

  // 解析 PLY 头部
  const header = parsePlyHeader(uint8Array);
  const vertexCount = header.vertexCount;
  const dataStart = header.dataStart;

  // 读取数据
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const f_dc = new Float32Array(vertexCount * 3);
  const f_rest = new Float32Array(vertexCount * 45); // 15 * 3
  const opacity = new Float32Array(vertexCount);
  const scale = new Float32Array(vertexCount * 3);
  const rot = new Float32Array(vertexCount * 4);

  let offset = dataStart;

  for (let i = 0; i < vertexCount; i++) {
    // 位置 (x, y, z)
    positions[i * 3] = dataView.getFloat32(offset, true);
    positions[i * 3 + 1] = dataView.getFloat32(offset + 4, true);
    positions[i * 3 + 2] = dataView.getFloat32(offset + 8, true);
    offset += 12;

    // 法线 (nx, ny, nz) - 可选
    normals[i * 3] = dataView.getFloat32(offset, true);
    normals[i * 3 + 1] = dataView.getFloat32(offset + 4, true);
    normals[i * 3 + 2] = dataView.getFloat32(offset + 8, true);
    offset += 12;

    // f_dc (0, 1, 2)
    f_dc[i * 3] = dataView.getFloat32(offset, true);
    f_dc[i * 3 + 1] = dataView.getFloat32(offset + 4, true);
    f_dc[i * 3 + 2] = dataView.getFloat32(offset + 8, true);
    offset += 12;

    // f_rest (0-44)
    for (let j = 0; j < 45; j++) {
      f_rest[i * 45 + j] = dataView.getFloat32(offset, true);
      offset += 4;
    }

    // opacity
    opacity[i] = dataView.getFloat32(offset, true);
    offset += 4;

    // scale (0, 1, 2)
    scale[i * 3] = dataView.getFloat32(offset, true);
    scale[i * 3 + 1] = dataView.getFloat32(offset + 4, true);
    scale[i * 3 + 2] = dataView.getFloat32(offset + 8, true);
    offset += 12;

    // rot (0, 1, 2, 3)
    rot[i * 4] = dataView.getFloat32(offset, true);
    rot[i * 4 + 1] = dataView.getFloat32(offset + 4, true);
    rot[i * 4 + 2] = dataView.getFloat32(offset + 8, true);
    rot[i * 4 + 3] = dataView.getFloat32(offset + 12, true);
    offset += 16;
  }

  return {
    positions,
    normals,
    f_dc,
    f_rest,
    opacity,
    scale,
    rot
  };
}

/**
 * 解析 PLY 文件头
 * @param uint8Array 字节数组
 * @returns 头部信息
 */
function parsePlyHeader(uint8Array: Uint8Array): { vertexCount: number; dataStart: number } {
  let headerText = '';
  let i = 0;

  // 读取头部直到遇到 end_header
  while (i < uint8Array.length) {
    const byte = uint8Array[i];
    headerText += String.fromCharCode(byte);
    if (headerText.includes('end_header\n')) {
      break;
    }
    i++;
  }

  // 解析顶点数量
  const vertexMatch = headerText.match(/element vertex (\d+)/);
  const vertexCount = vertexMatch ? parseInt(vertexMatch[1]) : 0;

  // 数据起始位置
  const dataStart = i + 1;

  return { vertexCount, dataStart };
}
