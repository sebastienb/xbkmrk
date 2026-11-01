import SwiftUI

struct BookmarkLinksView: View {
    let links: [BookmarkLink]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(links.count == 1 ? "Link in this bookmark" : "Links in this bookmark")
                .font(.headline)
            ForEach(links) { link in
                Link(destination: link.url) {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(link.title).font(.subheadline.weight(.semibold))
                                .lineLimit(nil).fixedSize(horizontal: false, vertical: true)
                            Text(link.host).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right").font(.subheadline)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
                }
                .accessibilityIdentifier("linkedPage-\(link.id)")
            }
        }
    }
}
