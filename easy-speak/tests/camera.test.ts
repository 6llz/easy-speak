import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CameraController } from '../src/lib/camera.ts';

function fakeStream() {
  let stops = 0;
  const stream = { getTracks: () => [{ stop: () => stops++ }] } as unknown as MediaStream;
  return { stream, getStops: () => stops };
}

test('关闭摄像头释放媒体轨道，多次结束不会重复停止已释放的轨道', async () => {
  const fake = fakeStream();
  const controller = new CameraController(async () => fake.stream);
  assert.equal(await controller.open(), fake.stream);
  controller.stop();
  controller.stop();
  assert.equal(fake.getStops(), 1);
});

test('挂断发生在权限请求返回前，后到的摄像头流也会立即关闭', async () => {
  const fake = fakeStream();
  let resolveStream: (stream: MediaStream) => void = () => {};
  const controller = new CameraController(
    () =>
      new Promise((resolve) => {
        resolveStream = resolve;
      }),
  );
  const pending = controller.open();
  controller.stop();
  resolveStream(fake.stream);
  assert.equal(await pending, null);
  assert.equal(fake.getStops(), 1);
});

test('并发开启以最新请求为准，旧权限结果不会覆盖新摄像头', async () => {
  const old = fakeStream(),
    latest = fakeStream();
  const resolvers: ((stream: MediaStream) => void)[] = [];
  const controller = new CameraController(() => new Promise((resolve) => resolvers.push(resolve)));
  const first = controller.open(),
    second = controller.open();
  resolvers[1](latest.stream);
  assert.equal(await second, latest.stream);
  resolvers[0](old.stream);
  assert.equal(await first, null);
  assert.equal(old.getStops(), 1);
  assert.equal(latest.getStops(), 0);
  controller.stop();
  assert.equal(latest.getStops(), 1);
});

test('摄像头权限拒绝能传播给界面提示，停止仍可安全执行', async () => {
  const controller = new CameraController(async () => {
    throw new DOMException('denied', 'NotAllowedError');
  });
  await assert.rejects(controller.open(), { name: 'NotAllowedError' });
  assert.doesNotThrow(() => controller.stop());
});
