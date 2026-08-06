'use strict';

const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function installStub(file, exports) {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

describe('company operations repository contract', () => {
  test('exports route and route-stop collections with findOne support', () => {
    class StubCollection {
      constructor(name) { this.name = name; }
      async findOne() { return null; }
    }
    installStub(path.join(root, 'src/repositories/domain/mongoCollection.js'), { MongoCollection: StubCollection });
    installStub(path.join(root, 'src/repositories/index.js'), {});
    installStub(path.join(root, 'src/services/shared/mongoUnitOfWork.js'), { runMongoUnitOfWork: async (work) => work(null) });

    const repositoryPath = path.join(root, 'src/repositories/domain/companyOperationsRepository.js');
    delete require.cache[require.resolve(repositoryPath)];
    const repository = require(repositoryPath);

    expect(repository.routes.name).toBe('routes');
    expect(typeof repository.routes.findOne).toBe('function');
    expect(repository.routeStops.name).toBe('routeStops');
    expect(typeof repository.routeStops.findOne).toBe('function');
  });
});
