export default [
  {
    key: 'id',
    types: ['string', 'number'],
    required: true
  },
  {
    key: 'user',
    types: ['boolean'],
    required: true
  },
  {
    key: 'trigger',
    types: ['string', 'number', 'function'],
    required: false
  },
  {
    key: 'validator',
    types: ['function'],
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

];
