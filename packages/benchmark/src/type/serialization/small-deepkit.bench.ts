import {f, jsonSerializer} from '@deepkit/type';
import {BenchSuite} from '@deepkit/core';

class Model {
    @f ready?: boolean;

    @f.array(String) tags: string[] = [];

    @f priority: number = 0;

    constructor(
        @f public id: number,
        @f public name: string
    ) {
    }
}
const ModelSerializer = jsonSerializer.for(Model);

export async function main() {
    const suite = new BenchSuite('deepkit');
    const plain = {
        name: 'name',
        id: 2,
        tags: ['a', 'b', 'c'],
        priority: 5,
        ready: true,
    };

    suite.add('deserialize', () => {
        ModelSerializer.deserialize(plain);
    });

    const item = jsonSerializer.for(Model).deserialize(plain);
    suite.add('serialize', () => {
        ModelSerializer.serialize(item);
    });

    suite.run();
}
