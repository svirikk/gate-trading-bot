import dotenv from 'dotenv';
import gateioService from '../services/gateio.service.js';
import logger from '../utils/logger.js';

dotenv.config();

async function checkBalance() {
  try {
    logger.info('Checking Gate.io balance...');
    
    await gateioService.connect();
    const balance = await gateioService.getUSDTBalance();
    
    console.log('\n' + '='.repeat(50));
    console.log(`💰 Gate.io USDT Balance: ${balance.toFixed(2)} USDT`);
    console.log('='.repeat(50) + '\n');
    
    process.exit(0);
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

checkBalance();
