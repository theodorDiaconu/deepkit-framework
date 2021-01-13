import { Database } from '@deepkit/orm';
import { plainToClass, t } from '@deepkit/type';
import { test } from '@jest/globals';
import { SQLiteDatabaseAdapter } from '../src/sqlite-adapter';

test('query aggregate', async () => {
    const product = t.schema({
        id: t.number.primary.autoIncrement,
        category: t.string,
        title: t.string,
        price: t.number,
        rating: t.number.default(0),
    }, { name: 'Product' });

    const database = new Database(new SQLiteDatabaseAdapter(':memory:'), [product]);
    await database.migrate();

    await database.persist(
        plainToClass(product, { id: 0, category: 'toys', title: 'Baer', price: 999, rating: 0 }),
        plainToClass(product, { id: 0, category: 'toys', title: 'Car', price: 499, rating: 0 }),
        plainToClass(product, { id: 0, category: 'planets', title: 'Mars', price: 45549, rating: 0 }),
    );

    const query = database.query(product);

    expect(await query.withSum('price').find()).toEqual([{price: 999+499+45549}]);
    expect(await query.groupBy('category').withSum('price').orderBy('category').find()).toEqual([{price: 45549}, {price: 999+499}]);

    expect(await query.withSum('price').find()).toEqual([{price: 999+499+45549}]);
    expect(await query.groupBy('category').withSum('price').orderBy('category').find()).toEqual([{category: 'planets', price: 45549}, {category: 'toys', price: 999+499}]);
    
    expect(await query.filter({price: {$lt: 1000}}).withSum('price').orderBy('category').find()).toEqual([{price: 999+499}]);
    expect(await query.filter({category: 'toys'}).groupBy('category').withSum('price').find()).toEqual([{category: 'toys', price: 999+499}]);
    
    expect(await query.groupBy('category').withSum('price').orderBy('category').having({price: {$lt: 2000}}).find()).toEqual([{category: 'toys', price: 999+499}]);

    expect(await query.groupBy('category').withSum('price').find()).toEqual([{category: 'planets', price: 45549}, {category: 'toys', price: 999+499}]);

    expect(await query.groupBy('category').withMin('price').orderBy('category').find()).toEqual([{category: 'planets', price: 45549}, {category: 'toys', price: 499}]);
    expect(await query.groupBy('category').withMax('price').orderBy('category').find()).toEqual([{category: 'planets', price: 45549}, {category: 'toys', price: 999}]);
    expect(await query.groupBy('category').withAverage('price').orderBy('category').find()).toEqual([{category: 'planets', price: 45549}, {category: 'toys', price: (999+499)/2}]);

    const groupConcat = await query.groupBy('category').withGroupConcat('price').orderBy('category').find();
    expect(groupConcat).toEqual([{category: 'planets', price: '45549.0'}, {category: 'toys', price: '999.0,499.0'}]);
});