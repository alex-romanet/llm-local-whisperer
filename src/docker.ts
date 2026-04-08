import { execSync } from 'child_process';

const CONTAINER_NAME = 'llm-whisper';
const IMAGE = 'onerahmet/openai-whisper-asr-webservice:latest';
const CONTAINER_PORT = 9000;

export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isContainerRunning(): boolean {
  try {
    const out = execSync(
      `docker ps --filter "name=^${CONTAINER_NAME}$" --format "{{.Names}}"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return out.trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}

function removeStoppedContainer(): void {
  try {
    execSync(`docker rm ${CONTAINER_NAME}`, { stdio: 'ignore' });
  } catch {
    // not present — fine
  }
}

// Start the Whisper container if it is not already running.
// Returns true if a new container was started (caller should stop it on exit),
// false if it was already running.
export async function startWhisper(hostPort: number = CONTAINER_PORT): Promise<boolean> {
  if (!isDockerAvailable()) return false;
  if (isContainerRunning()) return false;

  removeStoppedContainer();

  execSync(
    `docker run -d --name ${CONTAINER_NAME} -p ${hostPort}:9000 -e ASR_MODEL=tiny ${IMAGE}`,
    { stdio: 'ignore' }
  );

  // Poll logs until the server is ready (up to 60 s)
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const logs = execSync(`docker logs ${CONTAINER_NAME} 2>&1`, { encoding: 'utf-8' });
      if (/Application startup complete|Uvicorn running|Started server/i.test(logs)) {
        return true;
      }
    } catch {
      // logs not yet available
    }
  }

  return true; // started but may still be loading
}

// Stop and remove the container.
export function stopWhisper(): void {
  if (!isDockerAvailable()) return;
  try {
    execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'ignore' });
    execSync(`docker rm ${CONTAINER_NAME}`, { stdio: 'ignore' });
  } catch {
    // already stopped or never started
  }
}
