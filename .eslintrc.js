module.exports = {
    env: {
        browser: true,
        es2021: true,
        mocha: true,
        node: true,
    },
    extends: [
        'airbnb-base',
    ],
    parserOptions: {
        ecmaVersion: 12,
        sourceType: 'module',
    },
    rules: {
        indent: ['error', 4],
        'no-await-in-loop': 'off',
        'no-constant-condition': 'off',
        'no-continue': 'off',
        'no-restricted-syntax': 'off',
        'no-console': 'off',
    },
};
