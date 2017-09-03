// import VBox from './vbox.js'
// const path = require('path')
import logger from './logger'
const { exec } = require('child_process')
const sudo = require('sudo-prompt')

function execute (command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout || stderr)
      }
    })
  })
}

// options not supported in windows
function sudoExec (cmd, options = {name: 'VRouter'}) {
  return new Promise((resolve, reject) => {
    sudo.exec(cmd, options, (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else {
        resolve(stdout || stderr)
      }
    })
  })
}

async function disableIPV6 () {
  const index = await getActiveAdapterIndex()
  const subCmd = `WMIC nicconfig where "InterfaceIndex = ${index}" get description`

  // Description
  // Intel(R) Centrino(R) Wireless-N 1000
  const headerIncludedOutput = await execute(subCmd)
  const description = headerIncludedOutput.split('\n')[1].trim()

  const cmd = `powershell -Command {Disable-NetAdapterBinding -InterfaceDescription "${description}" -ComponentID ms_tcpip6}`
  // const cmd = `Disable-NetAdapterBinding -InterfaceDescription "${description}" -ComponentID ms_tcpip6`
  console.log('Disable-NetAdapterBinding works in powershell only. I need to find out how to run powershell as administrator')
  logger.debug(`about to disable IPV6 of Adapter: ${description}`)
  return sudoExec(cmd)
}

async function togglePhysicalAdapterConnection (action = 'off') {
  // Pratice: no need to config dns
  const fakeIP = '168.254.254.254'
  const fakeMast = '255.0.0.0'
  const index = await getActiveAdapterIndex()
  const onCmd = `WMIC nicconfig where "InterfaceIndex = ${index}" call EnableDHCP`
  const offCmd = `WMIC nicconfig where "InterfaceIndex = ${index}" call EnableStatic ("${fakeIP}"),("${fakeMast}")`
  const cmd = action === 'on' ? onCmd : offCmd
  return sudoExec(cmd)
}

async function getActiveAdapterIndexAndName () {
  const cmd = 'WMIC nic where "PhysicalAdapter = TRUE and NetConnectionStatus = 2" get InterfaceIndex,Name'

  // InterfaceIndex  Name
  // 11              Intel(R) 82577LM Gigabit Network Connection
  // 7               VirtualBox Host-Only Ethernet Adapter

  const headerIncludedIfs = await execute(cmd)
  const physicalIfs = []

  const indexAndNamePattern = /^(\d+)\s*(.*)$/i // 注意不要添加 g 标志
  headerIncludedIfs.split('\n').slice(1).forEach(line => {
    const matchResult = indexAndNamePattern.exec(line.trim())
    if (matchResult && !/virtualbox/ig.test(matchResult[2])) {
      physicalIfs.push({
        index: parseInt(matchResult[1].trim()),
        infName: matchResult[2]
      })
    }
  })
  return physicalIfs[0]
}

async function getActiveAdapterIndex () {
  const indexAndName = await getActiveAdapterIndexAndName()
  return indexAndName.index
}

async function changeDns (ip) {
  await disableIPV6()
  const infIndex = await getActiveAdapterIndex()
  const cmd = `WMIC nicconfig where "InterfaceIndex = ${infIndex}" call SetDNSServerSearchOrder ("${ip}")`
  logger.info(`about to changeDns to ${ip}`)
  return execute(cmd)
}

async function changeGateway (ip) {
  logger.info(`about to changeGateway to ${ip}`)
}

async function getRouterIP () {
  const infIndex = await getActiveAdapterIndex()
  const cmd = `WMIC nicconfig where "InterfaceIndex = ${infIndex}" get DHCPServer`

  // DHCPServer
  // 192.168.10.1
  const headerIncludedOutput = await execute(cmd)
  const DNSServer = headerIncludedOutput.split('\n')[1].trim()
  logger.debug(`Router IP: ${DNSServer}`)
  return DNSServer
}

class Win {
  static async getActiveAdapter () {
    const indexAndName = await getActiveAdapterIndexAndName()
    return indexAndName.infName
  }

  static async getCurrentGateway () {
    // tracert -h 1 -4 -w 100 114.114.114.114

    // 通过最多 1 个跃点跟踪
    // 到 public1.114dns.com [114.114.114.114] 的路由:
    //
    //   1    <1 毫秒   <1 毫秒   <1 毫秒 vrouter.lan [10.19.28.37]
    //
    // 跟踪完成。
    const infIndex = await getActiveAdapterIndex()
    const cmd = `WMIC nicconfig where "InterfaceIndex = ${infIndex}" get DefaultIPGateway`

    const headerIncludedOutput = await execute(cmd)
    // DefaultIPGateway
    // {"192.168.10.1", "xxxx"}

    // 删除以下字符: {, }, ", 空格
    const gateways = headerIncludedOutput.split('\n')[1].replace(/({|}|"|\s)/ig, '').split(',')
    return gateways[0]
  }

  static async getCurrentDns () {
    // nslookup.exe 10.19.28.37

    // 服务器:  vrouter.lan
    // Address:  10.19.28.37
    //
    // 名称:    vrouter.lan
    // Address:  10.19.28.37

    const infIndex = await getActiveAdapterIndex()
    const cmd = `WMIC nicconfig where "InterfaceIndex = ${infIndex}" get DNSServerSearchOrder`

    const headerIncludedOutput = await execute(cmd)
    // DefaultIPGateway
    // {"192.168.10.1", "xxxx"}

    // 删除以下字符: {, }, ", 空格
    const dnses = headerIncludedOutput.split('\n')[1].replace(/({|}|"|\s)/ig, '').split(',')
    return dnses[0]
  }

  static async changeRouteTo (ip) {
    await changeGateway(ip)
    await changeDns(ip)
  }

  static async resetRoute () {
    const routerIP = await getRouterIP()
    await Win.changeRouteTo(routerIP)
  }
}

export default Win
