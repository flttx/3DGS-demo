/**
 * gsplat 模型居中与缩放工具
 * 端口自 awa-community-web/src/pages/3d-editor/lib/gsplat-model-scale.ts
 */
import { Entity, Vec3, WORKBUFFER_UPDATE_ONCE } from 'playcanvas';

const offsetScratch = new Vec3();

/**
 * 世界空间下 gsplat AABB 中心（考虑实体旋转与缩放）。
 * 返回 null 表示实体尚无可用 resource/aabb。
 */
export function getGsplatCenterWorld(entity: Entity, out = new Vec3()): Vec3 | null {
  const resource = entity.gsplat?.resource;
  if (!resource?.aabb) return null;

  const scale = entity.getLocalScale();
  entity.getLocalRotation().transformVector(resource.aabb.center, out);
  out.x *= scale.x;
  out.y *= scale.y;
  out.z *= scale.z;
  out.add(entity.getPosition());
  return out;
}

/** 把实体放置到使其缩放后的 gsplat AABB 中心落在 targetWorld。 */
export function centerModelAt(entity: Entity, targetWorld: Vec3): void {
  const resource = entity.gsplat?.resource;
  if (!resource?.aabb) return;

  const scale = entity.getLocalScale();
  entity.getLocalRotation().transformVector(resource.aabb.center, offsetScratch);
  offsetScratch.x *= scale.x;
  offsetScratch.y *= scale.y;
  offsetScratch.z *= scale.z;
  entity.setLocalPosition(
    targetWorld.x - offsetScratch.x,
    targetWorld.y - offsetScratch.y,
    targetWorld.z - offsetScratch.z,
  );
}

function invalidateGsplatWorkBuffer(entity: Entity): void {
  const gsplat = entity.gsplat;
  if (!gsplat) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyGsplat = gsplat as any;
  if (typeof anyGsplat.setWorkBufferModifier === 'function') {
    anyGsplat.setWorkBufferModifier(null);
  }
  anyGsplat.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
}

/** asset/帧切换后重建工作缓冲（保持实体缩放）。 */
export function refreshGsplatModelScaleWorkBuffer(entity: Entity): void {
  if (!entity.gsplat) return;
  invalidateGsplatWorkBuffer(entity);
}
