export default [
  {
    key: '_',
    types: ['object'],
    required: true
  },
  {
    key: 'id',
    types: ['string', 'number'],
    required: true
  },
  {
    key: 'message',
    types: ['string', 'function'],
    required: true
  },
  {
    key: 'avatar',
    types: ['string'],
    required: false
  },
  {
    key: 'trigger',
    types: ['string', 'number', 'function'],
    required: false
  },
  {
    key: 'delay',
    types: ['number'],
    required: false
  },
  {
    key: 'end',
    types: ['boolean'],
    required: false
  },
  {
    key: 'placeholder',
    types: ['string'],
    required: false
  },
  {
    key: 'hideInput',
    types: ['boolean'],
    required: false
  },
  {
    key: 'inputAttributes',
    types: ['object'],
    required: false
  },
  {
    key: 'metadata',
    types: ['object'],
    required: false
  },
  {
    key: 'key',
    types: ['string'],
    required: false
  },
  {
    key: 'stageName',
    types: ['string'],
    required: false
  },
  {
    key: 'when',
    types: ['string', 'number'],
    required: false
  },
  {
    key: 'whenFmt',
    types: ['string'],
    required: false
  },
  {
    key: 'bot',
    types: ['boolean'],
    required: false
  },
  {
    key: 'downlink',
    types: ['string','object'],
    required: false
  },
  {
    key: 'uplink',
    types: ['string','object'],
    required: false
  },
  {
    key: 'who',
    types: ['string', 'number'],
    required: false
  },
  {
    key: 'where',
    types: ['string'],
    required: false
  },
  {
    key: 'post',
    types: ['object'],
    required: false
  },
  {
    key: 'author',
    types: ['object'],
    required: false
  },
  {
    key: 'options',
    types: ['object'],
    required: false
  },
  {
    key: 'answer',
    types: ['string'],
    required: false
  },
];
