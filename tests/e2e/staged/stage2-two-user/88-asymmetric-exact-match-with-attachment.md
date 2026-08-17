# Asymmetric exact match + IPFS photo auto-share + mutual deal confirmation (§30.2)

Eve is selling an iPhone and wants to describe it fully — color, condition, storage — for buyers
who care about the specifics, so she authors a detailed matchThreshold route talk (the same shape
`80-route-multi-spec-match-percent.spec.ts` covers). But Adam just wants "an iPhone, any
condition." He shouldn't have to walk through Eve's detailed spec tree, and answering it partway
shouldn't be required for a real match.

So Eve also authors a second, minimal talk: one question ("Want to buy an iPhone, any
condition?"), one match answer, her photo attached. Adam responds to *only* that simple talk.
Matching in this system is inherently unidirectional per exchange — `checkIfMatch` evaluates the
responder's answers against the *matched talk's own* structure, nothing else — so this asymmetry
falls out of the existing engine for free: Adam's exact, one-answer match is entirely independent
of Eve's separate detailed listing, which he never opens and which never factors into the result.

**What this proves:**
- **Asymmetric, unidirectional exact match, no new engine work.** Eve's simple talk and her
  detailed route talk are two independent talks. Adam matches the simple one exactly (one
  question, one answer, no scoring/threshold math) while the detailed one sits untouched — its
  response count stays at zero throughout.
- **IPFS photo auto-share.** Eve's photo (published to her own content node, a real
  content-addressed CID, `enc: 'none'`) is attached to the *matched* talk. The moment Adam
  matches, `autoShareMatchedTalkAttachments` (app.ts) sends the link — never the raw bytes — into
  their new conversation automatically. Both sides see the attachment chip render with the
  correct CID and filename. (Receiver-side fetch/decrypt of the underlying bytes is exercised
  separately by `talks-matching/09-ipfs-auto-share.spec.ts`; this test only needs to prove the
  share reaches the right conversation.)
- **Deal is a separate, mutual step.** The match alone isn't exclusive or final. Eve confirming
  first leaves her talk enabled and her deal status reads "waiting for the other side." Only once
  Adam also confirms does either side see "Deal confirmed."
- **Deal confirmation is scoped by dealEligible, not blanket.** Eve's simple talk (which declares
  `selfTag`/`preferenceSet`, making it deal-eligible) disables once the deal is mutually confirmed.
  Her detailed route talk — which never declared a `selfTag` — was never deal-eligible in the
  first place, so it's untouched and stays open for other buyers.
