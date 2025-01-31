import { test } from '@jest/globals';
import { activeRecordTests, aggregateTest, bookstoreTests, softDeleteTests, usersTests } from '@deepkit/orm-integration';
import { databaseFactory } from './factory';

for (const i in bookstoreTests) {
    test(i, async () => {
        await bookstoreTests[i](databaseFactory);
    });
}

for (const i in usersTests) {
    test(i, async () => {
        await usersTests[i](databaseFactory);
    });
}

for (const i in activeRecordTests) {
    test(i, async () => {
        await activeRecordTests[i](databaseFactory);
    });
}

for (const i in softDeleteTests) {
    test(i, async () => {
        await softDeleteTests[i](databaseFactory);
    });
}

for (const i in aggregateTest) {
    test(i, async () => {
        await aggregateTest[i](databaseFactory);
    });
}


test('placeholder', async () => {
});

