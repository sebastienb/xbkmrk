import Foundation
import Observation

@MainActor @Observable
final class LibraryModel {
    private(set) var bookmarks: [Bookmark] = []
    private(set) var total = 0
    private(set) var nextCursor: String?
    private(set) var effectiveMode: String?
    private(set) var isLoading = true
    private(set) var isLoadingMore = false
    private(set) var loadedQuery: BookmarkQuery?
    var error: String?
    var pageError: String?
    var actionError: String?
    private(set) var updatingIDs: Set<String> = []
    private var readOverrides: [String: Bool] = [:]
    private var generation = UUID()

    func reload(query: BookmarkQuery, client: ArchiveClient, session: AppSession, debounce: Bool) async {
        let current = UUID()
        generation = current
        isLoading = true
        isLoadingMore = false
        readOverrides = [:]
        error = nil
        pageError = nil
        nextCursor = nil
        if query != loadedQuery { bookmarks = [] }
        defer { if generation == current { isLoading = false } }
        do {
            if debounce { try await Task.sleep(for: .milliseconds(300)) }
            let page = try await client.bookmarks(query: query)
            try Task.checkCancellation()
            guard generation == current else { return }
            bookmarks = applyingReadUpdates(to: page.bookmarks, query: query)
            total = max(bookmarks.count, page.total - (page.bookmarks.count - bookmarks.count))
            nextCursor = page.nextCursor
            effectiveMode = page.mode
            loadedQuery = query
        } catch {
            guard !Task.isCancelled, generation == current else { return }
            self.error = session.handle(error)
        }
    }

    func loadMore(client: ArchiveClient, session: AppSession) async {
        guard let nextCursor, let loadedQuery, !isLoading, !isLoadingMore else { return }
        let current = generation
        isLoadingMore = true
        pageError = nil
        defer { if generation == current { isLoadingMore = false } }
        do {
            let page = try await client.bookmarks(query: loadedQuery, cursor: nextCursor)
            try Task.checkCancellation()
            guard generation == current else { return }
            let existing = Set(bookmarks.map(\.id))
            bookmarks.append(contentsOf: applyingReadUpdates(to: page.bookmarks, query: loadedQuery).filter { !existing.contains($0.id) })
            self.nextCursor = page.nextCursor == nextCursor ? nil : page.nextCursor
        } catch {
            if !Task.isCancelled, generation == current { pageError = session.handle(error) }
        }
    }

    func toggleRead(_ bookmark: Bookmark, client: ArchiveClient, session: AppSession) async {
        guard updatingIDs.insert(bookmark.id).inserted else { return }
        defer { updatingIDs.remove(bookmark.id) }
        do {
            let read = bookmark.readAt == nil
            try await client.setRead(read, id: bookmark.id)
            readOverrides[bookmark.id] = read
            guard let index = bookmarks.firstIndex(where: { $0.id == bookmark.id }) else { return }
            if loadedQuery?.reading == .saves && read || loadedQuery?.reading == .archive && !read {
                bookmarks.remove(at: index)
                total = max(0, total - 1)
            } else {
                bookmarks[index].readAt = read ? Date().ISO8601Format() : nil
            }
        } catch {
            self.actionError = session.handle(error)
        }
    }

    private func applyingReadUpdates(to items: [Bookmark], query: BookmarkQuery) -> [Bookmark] {
        items.compactMap { original in
            guard let read = readOverrides[original.id] else { return original }
            if query.reading == .saves && read || query.reading == .archive && !read { return nil }
            var updated = original
            updated.readAt = read ? Date().ISO8601Format() : nil
            return updated
        }
    }
}
