# Arbitration Client

## Getting Started

To start using this arbitration client, the project can be started in one of the following ways:

1. Local startup projects

   ```shell
   yarn install
   ```
   ```shell
   npm run dev
   ```
   
2. Docker startup project

   ```shell
   docker-compose up --detach --build
   ```

## Modify Configuration

Modify your program configuration, the private key will be stored locally via encryption.

If you are on the arbitration client side, refer to the following configuration:

   ```shell
  curl --location 'http://localhost:3000/config' \
    --header 'Content-Type: application/json' \
    --data '{
        "privateKey": "Enter your private key",
        "secretKey": "Arbitrary string for encrypting the private key",
        "rpc": "Ether mainnet RPC node, e.g., https://eth.llamarpc.com",
        "debug": 1,
        "makerApiEndpoint": "https://openapi.orbiter.finance/maker-openapi",
        "gasLimit": "",
        "maxFeePerGas": "",
        "maxPriorityFeePerGas": ""
    }'
   ```

If you are on the maker response side, refer to the following configuration:

   ```shell
  curl --location 'http://localhost:3000/config' \
    --header 'Content-Type: application/json' \
    --data '{
        "privateKey": "Enter your private key",
        "secretKey": "Arbitrary string for encrypting the private key",
        "rpc": "Ether mainnet RPC node, e.g., https://eth.llamarpc.com",
        "debug": 1,
        "makerApiEndpoint": "https://openapi.orbiter.finance/maker-openapi",
        "gasLimit": "",
        "maxFeePerGas": "",
        "maxPriorityFeePerGas": "",
        "makerList": ["0x227d76ab1cea2edfc9a62833af1743259c1f055f"], 
    }'
   ```

    
## Description of the program execution process

...
