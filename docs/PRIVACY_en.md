# Data Architecture and Privacy

PICTOS.net is a research prototype developed as part of doctoral research in design for Augmentative and Alternative Communication (AAC). This document states what data the platform handles, where it resides, and what leaves your device. Every claim here is verifiable by inspection of this repository.

## Research prototype status

PICTOS.net is a public research prototype. No research study is currently recruiting participants through this site, and no research data is being collected from its visitors or users. Should the platform be used within a formal study in the future, participation will be governed by an approved ethics protocol and explicit informed consent, and that status will be announced here.

## Local-first by design

Everything you create in PICTOS.net (pictograms, libraries, working state) is stored in your own browser, on your own device, using IndexedDB and localStorage. There is no server-side database of user content. There are no user accounts held by the project, no analytics, no advertising cookies, no third-party trackers, and no behavioural profiling of any kind.

The practical consequence: your work belongs to you, lives with you, and disappears when you clear your browser storage. There is no central copy.

## What leaves your device

Exactly two flows cross the boundary of your device, both visible in the source code.

First, generation requests. When you ask the system to produce a pictogram, the text you typed is sent to external model APIs (Anthropic for linguistic analysis and composition, Recraft for SVG generation) and the result is returned to your browser. This is transient processing; the project retains nothing.

Second, sharing you initiate. You may choose to publish a pictogram library using a token that you configure yourself. Nothing is shared by default and nothing is shared silently. Shared libraries record authorship, library name, and provenance, so that attribution is preserved and content can be reviewed or withdrawn.

## Sovereignty

The design principle behind these choices is user sovereignty: the person who creates communication materials, and the person who communicates through them, retain control over that material. Storage on your device, sharing only at your initiative, recording capabilities under your control, and open formats (SVG, JSON) that you can take elsewhere at any time.

## Licensing and auditability

The source code is licensed under Apache 2.0. Pictograms generated with the tool may be shared under CC-BY 4.0 at the author's choice. The entire codebase is public in this repository: any statement in this document can be checked against the code, and issues or questions about data handling are welcome through the repository's issue tracker.
