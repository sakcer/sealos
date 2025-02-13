import * as k8s from '@kubernetes/client-node';
// import { customAlphabet } from 'nanoid';
import { k8sFormatTime } from '@/utils/format';
import { StatusCR, UserCR } from '@/types';

export function K8sApiDefault(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  return kc;
}

async function watchClusterObject({
  kc,
  group,
  version,
  plural,
  name,
  interval = 1000,
  timeout = 15000
}: {
  kc: k8s.KubeConfig;
  group: string;
  version: string;
  plural: string;
  name: string;
  interval?: number;
  timeout?: number;
}) {
  let lastbody;
  const startTime = Date.now();
  const client = kc.makeApiClient(k8s.CustomObjectsApi);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    let body = null;
    try {
      const data = await client.getClusterCustomObjectStatus(group, version, plural, name);
      body = data.body;
      console.log(body);
      if (
        'status' in body &&
        // @ts-ignore
        'kubeConfig' in body.status &&
        JSON.stringify(body) !== JSON.stringify(lastbody)
      ) {
        lastbody = body;
        // @ts-ignore
        return body.status.kubeConfig as string;
      }
    } catch (err) {
      console.error(`Failed to get status for ${name}: ${err}`);
    }
    if (Date.now() - startTime >= timeout) {
      console.error(`Timed out after ${timeout} ms.`);
      break;
    }
  }
}
async function watchCustomClusterObject({
  kc,
  group,
  version,
  plural,
  name,
  fn = (pre, cur) => JSON.stringify(pre) !== JSON.stringify(cur),
  interval = 1000,
  timeout = 15000
}: {
  kc: k8s.KubeConfig;
  group: string;
  version: string;
  plural: string;
  name: string;
  fn?: (pre: any, cur: any) => boolean;
  interval?: number;
  timeout?: number;
}) {
  let lastbody;
  const startTime = Date.now();
  const client = kc.makeApiClient(k8s.CustomObjectsApi);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    let body = null;
    try {
      const data = await client.getClusterCustomObjectStatus(group, version, plural, name);
      body = data.body;
      if (fn(lastbody as any, body as any)) {
        lastbody = body;
        return body;
      }
    } catch (err) {
      console.error(`Failed to get status for ${name}: ${err}`);
    }
    if (Date.now() - startTime >= timeout) {
      console.error(`Timed out after ${timeout} ms.`);
      break;
    }
  }
  return null;
}
async function setUserKubeconfig(kc: k8s.KubeConfig, uid: string, k8s_username: string) {
  const resourceKind = 'User';
  const group = 'user.sealos.io';
  const version = 'v1';
  const plural = 'users';
  const updateTime = k8sFormatTime(new Date());
  const client = kc.makeApiClient(k8s.CustomObjectsApi);
  const body = await client
    .getClusterCustomObject(group, version, plural, k8s_username)
    .then((res) => res.body as UserCR)
    .catch((res) => {
      const body = res.body as StatusCR;
      if (
        body &&
        body.kind === 'Status' &&
        res.body.reason === 'NotFound' &&
        res.body.code === 404
      ) {
        return Promise.resolve(body);
      } else {
        console.error(res);
        return Promise.reject(res);
      }
    });
  if (body.kind !== resourceKind) {
    const resourceObj = {
      apiVersion: 'user.sealos.io/v1',
      kind: resourceKind,
      metadata: {
        name: k8s_username,
        labels: {
          uid,
          updateTime
        }
      }
    };
    await client.createClusterCustomObject(group, version, plural, resourceObj);
  } else {
    body.metadata.labels = {
      uid,
      updateTime
    };
    const patchs = [{ op: 'replace', path: '/metadata/labels/updateTime', value: updateTime }];
    await client.patchClusterCustomObject(
      group,
      version,
      plural,
      k8s_username,
      patchs,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          'Content-Type': 'application/json-patch+json'
        }
      }
    );
  }
  return k8s_username;
}

async function setUserTeam(kc: k8s.KubeConfig, k8s_username: string) {
  const group = 'user.sealos.io';
  const version = 'v1';
  const plural = 'users';
  const updateTime = k8sFormatTime(new Date());
  const client = kc.makeApiClient(k8s.CustomObjectsApi);
  const patchs = [
    { op: 'add', path: '/metadata/labels/user.sealos.io~1type', value: 'Group' },
    { op: 'replace', path: '/metadata/labels/updateTime', value: updateTime }
  ];
  await client.patchClusterCustomObject(
    group,
    version,
    plural,
    k8s_username,
    patchs,
    undefined,
    undefined,
    undefined,
    {
      headers: {
        'Content-Type': 'application/json-patch+json'
      }
    }
  );
  return k8s_username;
}
async function removeUserTeam(kc: k8s.KubeConfig, k8s_username: string) {
  const group = 'user.sealos.io';
  const version = 'v1';
  const plural = 'users';
  const updateTime = k8sFormatTime(new Date());
  const client = kc.makeApiClient(k8s.CustomObjectsApi);
  const patchs = [
    { op: 'add', path: '/metadata/labels/user.sealos.io~1status', value: 'Deleted' },
    { op: 'replace', path: '/metadata/labels/updateTime', value: updateTime }
  ];
  await client.patchClusterCustomObject(
    group,
    version,
    plural,
    k8s_username,
    patchs,
    undefined,
    undefined,
    undefined,
    {
      headers: {
        'Content-Type': 'application/json-patch+json'
      }
    }
  );
  return k8s_username;
}
// 系统迁移
async function setUserKubeconfigByuid(kc: k8s.KubeConfig, uid: string) {
  const resourceType = 'User';
  const group = 'user.sealos.io';
  const version = 'v1';
  const plural = 'users';
  const labelSelector = `uid=${uid}`;
  let name: string = '';
  const client = kc.makeApiClient(k8s.CustomObjectsApi);
  const { response } = (await client.listClusterCustomObject(
    group,
    version,
    plural,
    undefined,
    undefined,
    undefined,
    undefined,
    labelSelector
  )) as unknown as { response: { body: { items: any[] } } };
  if (response.body.items.length === 0) {
    console.log(`Created new ${resourceType} with labels ${JSON.stringify(labelSelector)}`);
  } else {
    // 找name
    const existingResource = response.body.items[response.body.items.length - 1];
    name = existingResource.metadata.name;
  }
  return name;
}

export const getUserKubeconfigByuid = async (uid: string) => {
  const kc = K8sApiDefault();
  return await setUserKubeconfigByuid(kc, uid);
};

export const getUserKubeconfig = async (uid: string, k8s_username: string) => {
  const kc = K8sApiDefault();
  const group = 'user.sealos.io';
  const version = 'v1';
  const plural = 'users';
  await setUserKubeconfig(kc, uid, k8s_username);

  let kubeconfig = await watchClusterObject({
    kc,
    group,
    version,
    plural,
    name: k8s_username
  });
  return kubeconfig;
};
export const setUserTeamCreate = async (k8s_username: string) => {
  const kc = K8sApiDefault();
  const group = 'user.sealos.io';
  const version = 'v1';
  const plural = 'users';
  await setUserTeam(kc, k8s_username);

  let body = await watchCustomClusterObject({
    kc,
    group,
    version,
    plural,
    fn(_, cur) {
      return cur?.metadata?.labels?.['user.sealos.io/type'] === 'Group';
    },
    name: k8s_username
  });
  return body;
};
export const setUserTeamDelete = async (k8s_username: string) => {
  const kc = K8sApiDefault();
  const group = 'user.sealos.io';
  const version = 'v1';
  const plural = 'users';

  await removeUserTeam(kc, k8s_username);

  let body = await watchCustomClusterObject({
    kc,
    group,
    version,
    plural,
    fn(_, cur) {
      console.log(cur?.metadata?.labels?.['user.sealos.io/status']);
      return cur?.metadata?.labels?.['user.sealos.io/status'] === 'Deleted';
    },
    name: k8s_username
  });
  return body;
};
