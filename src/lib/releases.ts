import appPackage from '../../package.json';

export const defaultReleaseRepository = appPackage.repository.url
  .replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

export function releaseRepository(value = process.env.SALMON_RELEASE_REPOSITORY || defaultReleaseRepository) {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(value)) throw new Error('发布仓库格式应为 owner/repository');
  return value;
}

export function releaseFeed(repository = releaseRepository()) {
  return `https://github.com/${releaseRepository(repository)}/releases/latest/download/`;
}
