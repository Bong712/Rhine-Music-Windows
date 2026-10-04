import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { writeJsonAtomic } from './music-library.mjs'

const text = (value) => typeof value === 'string' ? value.trim() : ''
const pathKey = (value) => {
  const absolute = path.resolve(value).normalize('NFC')
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}
const refId = (rootPath, relativePath) => createHash('sha256').update(`${pathKey(rootPath)}\0${relativePath.normalize('NFC')}`).digest('hex').slice(0, 24)
const now = () => new Date().toISOString()

function validName(value) {
  const name = text(value)
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('歌单名称需要 1 至 100 个可见字符')
  return name
}

function validate(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.playlists) || value.playlists.length > 100) throw new Error('播放列表数据格式不受支持，已保留原文件')
  const ids = new Set()
  const playlists = value.playlists.map((playlist) => {
    if (!playlist || typeof playlist.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(playlist.id) || ids.has(playlist.id) || !Array.isArray(playlist.tracks) || playlist.tracks.length > 20000) throw new Error('播放列表数据格式不受支持，已保留原文件')
    ids.add(playlist.id)
    const tracks = playlist.tracks.map((track) => {
      if (!track || typeof track.rootPath !== 'string' || !path.isAbsolute(track.rootPath) || typeof track.relativePath !== 'string' || path.isAbsolute(track.relativePath) || typeof track.id !== 'string') throw new Error('播放列表曲目引用格式不受支持，已保留原文件')
      const resolved = path.resolve(track.rootPath, track.relativePath)
      const relative = path.relative(path.resolve(track.rootPath), resolved)
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('播放列表曲目引用越出了音乐目录')
      return {
        id: track.id,
        rootPath: path.resolve(track.rootPath),
        relativePath: track.relativePath,
        trackId: text(track.trackId),
        albumId: text(track.albumId),
        title: text(track.title) || '未知歌曲',
        artist: text(track.artist) || '未知艺术家',
        album: text(track.album),
        duration: Number.isFinite(track.duration) && track.duration >= 0 ? track.duration : 0,
        addedAt: text(track.addedAt) || now(),
      }
    })
    const trackIds = new Set()
    for (const track of tracks) {
      if (trackIds.has(track.id)) throw new Error('播放列表中存在重复曲目引用，已保留原文件')
      trackIds.add(track.id)
    }
    return { id: playlist.id, name: validName(playlist.name), createdAt: text(playlist.createdAt) || now(), updatedAt: text(playlist.updatedAt) || now(), tracks }
  })
  return { version: 1, playlists }
}

export class PlaylistStore {
  constructor({ dataDir }) {
    this.dataDir = path.resolve(dataDir)
    this.file = path.join(this.dataDir, 'playlists.json')
    this.value = { version: 1, playlists: [] }
    this.saveChain = Promise.resolve()
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true })
    try {
      this.value = validate(JSON.parse(await fs.readFile(this.file, 'utf8')))
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`无法读取播放列表 ${this.file}: ${error.message}`)
      await this.save()
    }
    return this
  }

  async save() {
    const snapshot = structuredClone(this.value)
    this.saveChain = this.saveChain.catch(() => {}).then(() => writeJsonAtomic(this.file, snapshot))
    await this.saveChain
  }

  async list(library) {
    const flatReferences = this.value.playlists.flatMap((playlist) => playlist.tracks)
    const flatResolved = library.resolveTrackReferences(flatReferences)
    let offset = 0
    return this.value.playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      tracks: playlist.tracks.map((reference) => {
        const current = flatResolved[offset++]
        const available = !!current && !current.offline
        return {
          id: reference.id,
          trackId: current?.track.id ?? reference.trackId,
          albumId: current?.albumId ?? reference.albumId,
          title: current?.track.title ?? reference.title,
          artist: current?.track.artist ?? reference.artist,
          album: current?.albumTitle ?? reference.album,
          duration: current?.track.duration ?? reference.duration,
          available,
          track: available ? current.track : undefined,
        }
      }),
    }))
  }

  async create(name) {
    if (this.value.playlists.length >= 100) throw new Error('最多可创建 100 个播放列表')
    const playlist = { id: randomUUID(), name: validName(name), createdAt: now(), updatedAt: now(), tracks: [] }
    this.value.playlists.push(playlist)
    await this.save()
    return playlist
  }

  async rename(id, name) {
    const playlist = this.requirePlaylist(id)
    playlist.name = validName(name)
    playlist.updatedAt = now()
    await this.save()
    return playlist
  }

  async delete(id) {
    const playlist = this.requirePlaylist(id)
    this.value.playlists = this.value.playlists.filter((entry) => entry.id !== playlist.id)
    await this.save()
  }

  async addTracks(id, trackIds, library) {
    if (!Array.isArray(trackIds) || trackIds.length > 1000 || trackIds.some((trackId) => typeof trackId !== 'string')) throw new Error('trackIds 必须是最多 1000 项的曲目 ID 数组')
    const playlist = this.requirePlaylist(id)
    const known = new Set(playlist.tracks.map((track) => track.id))
    let added = 0
    let skipped = 0
    for (const trackId of trackIds) {
      const record = library.trackRecord(trackId)
      if (!record) { skipped += 1; continue }
      const id = refId(record.rootPath, record.relativePath)
      if (known.has(id)) continue
      known.add(id)
      playlist.tracks.push({
        id, rootPath: record.rootPath, relativePath: record.relativePath,
        trackId: record.track.id, albumId: record.albumId, title: record.track.title,
        artist: record.track.artist, album: record.albumTitle, duration: record.track.duration,
        addedAt: now(),
      })
      added += 1
    }
    if (added) {
      playlist.updatedAt = now()
      await this.save()
    }
    return { added, skipped, playlist }
  }

  async removeTrack(id, itemId) {
    const playlist = this.requirePlaylist(id)
    const before = playlist.tracks.length
    playlist.tracks = playlist.tracks.filter((track) => track.id !== itemId)
    if (playlist.tracks.length === before) throw new Error('播放列表中找不到这首歌曲')
    playlist.updatedAt = now()
    await this.save()
    return playlist
  }

  async reorder(id, itemIds) {
    const playlist = this.requirePlaylist(id)
    if (!Array.isArray(itemIds) || itemIds.length !== playlist.tracks.length || itemIds.some((itemId) => typeof itemId !== 'string') || new Set(itemIds).size !== itemIds.length) throw new Error('排序需要逐项列出当前播放列表中的每首歌曲')
    const byId = new Map(playlist.tracks.map((track) => [track.id, track]))
    if (itemIds.some((itemId) => !byId.has(itemId))) throw new Error('排序中包含不属于该播放列表的歌曲')
    playlist.tracks = itemIds.map((itemId) => byId.get(itemId))
    playlist.updatedAt = now()
    await this.save()
    return playlist
  }

  requirePlaylist(id) {
    const playlist = this.value.playlists.find((entry) => entry.id === id)
    if (!playlist) throw Object.assign(new Error('找不到该播放列表'), { status: 404 })
    return playlist
  }
}
