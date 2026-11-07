# 77-talk-to-me-tab-reverse-edge

covers: SPEC-13.7, SPEC-26.2

Verifies the Talk → Me-tab reverse edge: viewing a talk I have answered shows a "View in My
Answers" link that jumps to the Me-tab entry it produced. Before answering, an incoming talk's
response view shows no such link (there is no Me-tab entry to jump to). After answering with a
match, reopening the talk shows the link; clicking it closes the talk response modal, activates
the Me tab, and highlights the answer row showing the question prompt
(`.answer-talk-item.answer-item-highlighted`).
