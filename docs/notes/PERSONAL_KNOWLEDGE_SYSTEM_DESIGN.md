# Personal Knowledge System Design

> Status: baseline v0.1
> Scope: product design discussion only. This document does not prescribe the
> current application's implementation or roadmap.

## Progress

| Section | Status |
| --- | --- |
| 1. Product positioning | Confirmed |
| 2. Core principles | Confirmed |
| 3. Information model | In progress: resource, content, and timeline layers confirmed |
| 4. Information lifecycle | Pending |
| 5. Project spaces and global knowledge | Pending |
| 6. Indexing and discovery | Pending |
| 7. User workflows and interface | Pending |
| 8. AI and automation | Pending |
| 9. Data, sync, and permissions | Pending |
| 10. Product roadmap | Pending |

## 1. Product Positioning

This product is a personal, long-term knowledge, information, and creative
workbench. It also supports selectively publishing knowledge nodes, projects,
notes, and works as a personal knowledge repository and social surface.

It helps an individual:

- retain web pages, documents, PDFs, meeting material, images, video links, and personal ideas;
- focus on a current project, topic, or question without losing their long-term collection;
- transform source material into summaries, notes, reflections, conclusions, and creative work;
- retrieve and reuse information through low-maintenance indexing over time;
- keep content private by default while selectively sharing it publicly.

The product is not merely a file manager, a folder-based note app, a conventional
tag library, a manually maintained backlink graph, or a publishing-only social
site.

### Two Contexts, One Content Foundation

The same knowledge system has two contexts rather than two disconnected products:

- **Workbench context:** private, focused, and intended for ongoing collection,
  thinking, organization, and creation.
- **Repository and social context:** intended for browsing, publishing,
  following, discussion, and presenting selected public content, similar in
  spirit to a GitHub repository.

Users can move from their workbench to their repository or public projects
without copying content into a separate system. Visibility and presentation
change; the underlying content remains the same.

## 2. Core Principles

1. **Global accumulation, local focus.** All information can remain available
   long term, while the current interface centers one project, topic, or question.
2. **Low-maintenance by default.** Users should not need to predict a complete
   folder, tag, or link structure before knowledge can be saved. The system should
   progressively build indexes and suggest useful connections.
3. **Separate source material from personal processing.** Original material,
   summaries, notes, reflections, and conclusions remain distinguishable and can
   preserve their source relationships.
4. **Reuse across contexts.** A project space supports current attention; it must
   not prevent knowledge from being found or used in another project later.
5. **Human-oriented retrieval.** Finding information may use words, meaning,
   source, time, project, content type, and current context rather than a single
   directory hierarchy.
6. **Available on the right device.** Mobile use favors capture, lookup, and
   review; desktop use favors reading, processing, organization, and creation.
7. **User ownership and control.** Content is private by default. Users control
   sharing, export, migration, and long-term retention.
8. **AI assists rather than decides.** AI may extract, summarize, recommend, and
   organize, but must retain provenance and allow user confirmation, editing, and
   reversal.
9. **Knowledge evolves.** Information can gradually develop from source material
   into notes, conclusions, methods, and published work instead of requiring a
   final structure at first capture.

## Open Questions

- What is the smallest information unit that can be saved, related, retrieved,
  and published?
- Which relations should be automatic suggestions, and which require explicit
  user confirmation?
- Should a project space ever be a durable knowledge object, or only an attention
  boundary and working context?
- How prominent should public repository and social behavior be in the first
  product stage?

## 3. Information Model

### 3.1 Resource Layer (Confirmed)

The first information layer is a lightweight, global resource model. A resource
is source material that the user has imported or linked. It can be used from one
or many project spaces; a project is a working context rather than the owner of
the resource.

Supported first-stage resource forms:

- local Markdown files;
- local PDFs;
- local images, either standalone or inserted into Markdown;
- local general files;
- external web and video URLs.

Large media is not uploaded or hosted by the system in this stage. Video is kept
as an external link or embed reference. OCR, subtitle extraction, webpage body
capture, and other heavy extraction features are out of scope for this stage.

Each resource needs a stable identity and enough metadata for opening, display,
search, and later synchronization:

```text
resource id
resource kind
title
local path or external URL
created/imported time
last updated time
visibility and publication settings
preview/opening capability
```

The resource layer starts with local files and external URLs only. Cloud copies
and manual or automatic synchronization are future storage capabilities, not a
different resource type.

### 3.2 Resource Rules (Confirmed)

- Resources are global and may be referenced by multiple project spaces.
- A missing, moved, or deleted local file becomes an unavailable resource. Its
  metadata and user-authored notes remain available.
- Deleting a resource does not delete associated notes or references by default.
- A replaced file may invalidate page, text, or location references. The system
  warns about this rather than attempting full version migration initially.
- Publishing a node that cites a private resource requires an explicit choice:
  hide the source, show source metadata only, or publish the resource too.
- The public presentation selects a renderer by resource kind: Markdown content,
  PDF preview or download, image display, external link card or embed, and
  general-file description or download.

### 3.3 Content Nodes (Confirmed)

User-authored content has one intentionally broad form: a content node is an
independent Markdown file created incrementally by the user. It can hold a short
thought, a note, a summary, a reflection, a conclusion, a method, or a finished
work. The system does not require the user to classify it before saving it.

Users may add their own optional type marker or other marks. These are aids for
the user's own organization, not mandatory system categories or a prerequisite
for retrieval.

Markdown holds creative content. Separate metadata holds the minimum durable
system information:

```text
node id
Markdown body
optional title
optional user-defined marks
created and last-modified times
relations to resources, project spaces, and other nodes
private or public state
```

Nodes may evolve in place. A thought does not need to be copied into another
object before it can become a conclusion or a published work.

### 3.4 Timeline and Events (Confirmed)

Timeline data is an independent event system, not content embedded in Markdown.
It preserves how a person's information and work evolved while leaving the
creative file clean.

```text
event id
time
action: create, import, explicit save, relate, publish, archive, and similar
target: resource, content node, or project space
optional project context
necessary change summary
```

The system can compose personal, project, node, and review timelines from these
events. The initial event policy records meaningful actions only: it does not log
every keystroke, scroll, or incidental interaction. Opening or explicitly marking
content as read may be recorded for recall; fine-grained viewing behavior is not.

Events are private by default. A user may choose to show publication history for
public content, but editing and reading behavior is never public by default.
Users can hide or delete events they do not want to retain. Initial timeline data
records when content changed, while full Markdown version history remains a later
decision.

### 3.5 Relations (Confirmed)

Relations are incremental and low-maintenance. The system does not require a
user to construct a complete manual backlink graph. It distinguishes three
relation sources:

1. **Context relations:** a resource or node is being used in a project space.
2. **Explicit relations:** the user directly cites, embeds, links, or creates
   content from another resource or node.
3. **Suggested relations:** the system finds a possible connection from content,
   time, project context, or co-occurrence, but does not present it as fact until
   the user confirms it.

Natural usage should create the first two forms. For example, opening a PDF in a
project creates project context; creating a Markdown node from a PDF page creates
a source relation. A Markdown link creates an explicit relation.

Each relation has at least:

```text
source
target
relation source: user, system, or import
optional explanation or evidence
created time
confirmation state
visibility
```

Project spaces provide current relevance; they do not permanently own the
resources or nodes used within them. System suggestions remain suggestions until
confirmed, so automatic association cannot silently become user knowledge.

### 3.6 Project Spaces and Global Knowledge (Confirmed)

A project space is an attention boundary organized around a current goal or
question. It is neither a folder nor the permanent owner of its contents.

```text
project name
current goal or question
state: active, paused, complete, or archived
start and end times
currently relevant resources and Markdown nodes
current questions, tasks, and interim outputs
important project relations and timeline
```

Users may explicitly add resources and nodes to a project. Content opened,
edited, or cited within a project also gains project context automatically. The
system may recommend globally stored content relevant to the project, but never
adds it as project content without a user action.

Project views show what is currently relevant. Resources and nodes remain global
and can be used by multiple projects. When a project ends, it is archived with
its goal, timeline, key materials, and outputs; all underlying content remains
available globally. An archived project may later reopen or become a published
project presentation.

The first design avoids complex nested project hierarchies. Projects connect
naturally through shared content, explicit relations, and timelines rather than
through a multi-level directory tree.

### 3.7 Next: Indexing and Discovery

The next design task is to define how a user finds information without relying
on growing folders, mandatory tags, or manual backlinks.
