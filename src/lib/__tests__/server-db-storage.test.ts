import { describe, expect, it } from 'vitest'
import {
  assertSafeSqliteStorage,
  findMountForPath,
  isUnsafeNetworkFsType,
} from '../server-db'

const sampleMounts = [
  'overlay / overlay rw 0 0',
  '/dev/sda1 /app/data ext4 rw 0 0',
  'nas:/docker/sesh /mnt/nas nfs4 rw 0 0',
  '//nas/share /mnt/share cifs rw 0 0',
].join('\n')

describe('isUnsafeNetworkFsType', () => {
  it('flags known network filesystems', () => {
    expect(isUnsafeNetworkFsType('nfs4')).toBe(true)
    expect(isUnsafeNetworkFsType('cifs')).toBe(true)
    expect(isUnsafeNetworkFsType('fuse.sshfs')).toBe(true)
  })

  it('allows local filesystems', () => {
    expect(isUnsafeNetworkFsType('ext4')).toBe(false)
    expect(isUnsafeNetworkFsType('overlay')).toBe(false)
    expect(isUnsafeNetworkFsType(undefined)).toBe(false)
  })
})

describe('findMountForPath', () => {
  it('returns the longest matching mount prefix', () => {
    expect(findMountForPath('/app/data/sesh.db', sampleMounts)).toEqual({
      mountPoint: '/app/data',
      fsType: 'ext4',
    })
  })

  it('handles escaped spaces in mount paths', () => {
    const mounts = 'server:/share /Volumes/My\\040Drive nfs rw 0 0'
    expect(findMountForPath('/Volumes/My Drive/sesh.db', mounts)).toEqual({
      mountPoint: '/Volumes/My Drive',
      fsType: 'nfs',
    })
  })
})

describe('assertSafeSqliteStorage', () => {
  it('allows local disk paths', () => {
    expect(() => assertSafeSqliteStorage('/app/data/sesh.db', {
      realDbPath: '/app/data/sesh.db',
      mountsText: sampleMounts,
    })).not.toThrow()
  })

  it('rejects obvious NAS mount prefixes', () => {
    expect(() => assertSafeSqliteStorage('/mnt/nas/docker/sesh-web/data/sesh.db', {
      realDbPath: '/mnt/nas/docker/sesh-web/data/sesh.db',
    })).toThrow(/unsafe network-mounted path/i)
  })

  it('rejects network filesystem mount types', () => {
    const mounts = 'nas:/docker/sesh /app/data nfs4 rw 0 0'
    expect(() => assertSafeSqliteStorage('/app/data/sesh.db', {
      realDbPath: '/app/data/sesh.db',
      mountsText: mounts,
    })).toThrow(/refusing to open sqlite db on nfs4 mount/i)
  })
})
