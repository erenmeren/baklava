import React, { useState, FC } from "react"
import { Icons } from "./icons"

// Tab bileşeni için props tipi
interface TabProps {
  title: string
  onTabClose: () => void
  isActive: boolean
}

// Tab bileşeni
const Tab: FC<TabProps> = ({ title, onTabClose, isActive }) => (
  <div
    className={`flex cursor-pointer justify-between rounded-t-sm border p-1 text-sm ${
      isActive ? "border-b-0 border-black" : "border-gray-200"
    }`}
  >
    {title}
    <Icons.x className="ml-1 mt-0.5 h-4 w-4 " onClick={onTabClose} />
  </div>
)

const TabContainer: FC = () => {
  const [tabs, setTabs] = useState<string[]>(["Home"])
  const [activeTab, setActiveTab] = useState<number>(0)

  const addTab = (): void => {
    const newTab: string = `New Tab ${tabs.length + 1}`

    setTabs([...tabs, newTab])
    setActiveTab(tabs.length)
  }

  const closeTab = (index: number): void => {
    const newTabs = tabs.filter((_, i) => i !== index)
    setTabs(newTabs)
    if (index === activeTab && newTabs.length) {
      setActiveTab(newTabs.length - 1)
    }
  }

  return (
    <div className="flex px-1 pt-1">
      {tabs.map((tab, index) => (
        <Tab
          key={index}
          title={tab}
          isActive={index === activeTab}
          onTabClose={() => closeTab(index)}
        />
      ))}
      <Icons.plus onClick={addTab} className="ml-1 mt-1" />
    </div>
  )
}

export default TabContainer
