# Data Architecture and Privacy

PICTOS.net is a research prototype developed as part of doctoral research in design for Augmentative and Alternative Communication (AAC). This document states what data the platform handles, where it resides, and what leaves your device. Every claim here is verifiable by inspection of this repository.

## Research prototype status

PICTOS.net is a public research prototype. No research study is currently recruiting participants through this site, and no research data is being collected from its visitors or users. Should the platform be used within a formal study in the future, participation will be governed by an approved ethics protocol and explicit informed consent. That status will be stated here, but the site itself will not be used to recruit participants.

## Local-first by design

Everything you create in PICTOS.net (pictograms, libraries, working state) is stored in your own browser, on your own device, using IndexedDB and localStorage. There is no server-side database of user content. There are no analytics, no advertising cookies, no third-party trackers, and no behavioural profiling of any kind.

The practical consequence: your work belongs to you, lives with you, and disappears when you clear your browser storage. There is no central copy.

## Authentication and identity

PICTOS.net has no user database of its own. Sign-in exists solely as a human verification mechanism to prevent automated extraction of the AI services, not to identify or profile individuals, and signing in is not enrolment in any study.

Authentication is handled by Netlify Identity (GoTrue), the authentication service of the hosting provider. You may sign in with a Google account or with an email address and a password. Signing in with Google gives the site only your email address, your name and your profile photo URL as supplied by Google; the project receives no access to your Google account and requests nothing else from it. Signing in with email creates a record consisting of your email address and an encrypted password. This sign-in record is the only identity information held on a server.

To enforce the daily generation limit and keep the cost of the AI services bounded, the server also keeps a technical counter of generation calls per email address, together with the timestamp, the pipeline phase and the model used. This operational log exists for abuse prevention and cost control; it contains no utterances, no pictograms and no content of any kind, it is not analysed as research data, and it is not used to contact you.

The system does not store profiles, does not track sessions across visits, and does not build a behavioural history. The costs of the artificial intelligence services are funded by the lead researcher's personal account; users incur no charges and no obligations by using the tool.

## What leaves your device

Exactly two flows cross the boundary of your device, both visible in the source code.

First, generation requests. When you ask the system to produce a pictogram, the text you typed is sent to external model APIs (Anthropic for linguistic analysis and composition; Google Gemini or OpenAI for image generation, depending on the model selected in the tool) and the result is returned to your browser. This is transient processing; the project retains nothing. Do not type personal information about other people.

Second, sharing you initiate. You may choose to publish a pictogram library using a token that you configure yourself. Nothing is shared by default and nothing is shared silently. Shared libraries record authorship, library name, and provenance, so that attribution is preserved and content can be reviewed or withdrawn.

## Sovereignty

The design principle behind these choices is user sovereignty: the person who creates communication materials, and the person who communicates through them, retain control over that material. Storage on your device, sharing only at your initiative, recording capabilities under your control, and open formats (SVG, JSON) that you can take elsewhere at any time.

## Licensing and auditability

The source code is licensed under Apache 2.0. Pictograms generated with the tool may be shared under CC-BY 4.0 at the author's choice. The entire codebase is public in this repository: any statement in this document can be checked against the code, and issues or questions about data handling are welcome through the repository's issue tracker.
