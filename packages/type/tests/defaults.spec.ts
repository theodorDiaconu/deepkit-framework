import { expect, test } from '@jest/globals';
import { uuid } from '../src/utils';
import { getClassSchema, t } from '../index';

test('simple', () => {
    class User {
        @t id: string = uuid();

        @t username?: string;

        @t another: number = 2;

        bla = 'constructor()';

        constructor(nothing: string = '{') {
        }

        doSomething(): void {
            this.username = 'asd';
        }
    }

    const schema = getClassSchema(User);

    expect(schema.getProperty('id').hasDefaultValue).toBe(true);
    expect(schema.getProperty('username').hasDefaultValue).toBe(false);
    expect(schema.getProperty('another').hasDefaultValue).toBe(true);
});


test('auto detect isOptional class', () => {

    class User {
        @t id: string = uuid();

        @t username?: string;

        @t another: number = 2;

        @t.optional actualOptional: number = 2;

        constructor(@t public required: string = '') {
        }
    }

    const schema = getClassSchema(User);

    expect(schema.getProperty('required').hasDefaultValue).toBe(false);
    expect(schema.getProperty('required').isOptional).toBe(false);
    expect(schema.getProperty('id').hasDefaultValue).toBe(true);
    expect(schema.getProperty('id').isOptional).toBe(false);
    expect(schema.getProperty('username').hasDefaultValue).toBe(false);
    expect(schema.getProperty('username').isOptional).toBe(true);
    expect(schema.getProperty('another').hasDefaultValue).toBe(true);
    expect(schema.getProperty('another').isOptional).toBe(false);
    expect(schema.getProperty('actualOptional').isOptional).toBe(true);
});

test('auto detect isOptional class required', () => {
    class User {
        @t.mongoId.required _id!: string;
    }

    const schema = getClassSchema(User);
    expect(schema.getProperty('_id').manuallySetToRequired).toBe(true);
    expect(schema.getProperty('_id').isOptional).toBe(false);
});

test('auto detect isOptional schema', () => {
    const schema = t.schema({
        username: t.string.index({ unique: true }),
    }, { name: 'xxx' });

    expect(schema.getProperty('username').hasDefaultValue).toBe(false);
    expect(schema.getProperty('username').isOptional).toBe(false);
});

test('simple ie11 fake-class', () => {
    var User = /** @class */ (function () {
        function Children() {
            //@ts-ignore
            this.id = uuid();

            //@ts-ignore
            this.bar = 'constructor()';

            //@ts-ignore
            this.another = 2;

            //@ts-ignore
            this.nothing = '{'
        }

        Children.prototype.doSomething = function () {
            this.username = 'asdsad';
        };

        t.type(String)(Children, 'id');
        t.type(String)(Children, 'username');
        t.type(Number)(Children, 'another');

        return Children;
    }());

    const schema = getClassSchema(User);

    expect(schema.getProperty('id').hasDefaultValue).toBe(true);
    expect(schema.getProperty('username').hasDefaultValue).toBe(false);
    expect(schema.getProperty('another').hasDefaultValue).toBe(true);
});

