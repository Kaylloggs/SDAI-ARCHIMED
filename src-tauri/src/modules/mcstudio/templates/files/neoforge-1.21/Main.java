package {{package}};

import {{package}}.registry.ModBlocks;
import {{package}}.registry.ModItems;
import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;

@Mod({{main_class}}.MOD_ID)
public class {{main_class}} {
    public static final String MOD_ID = "{{mod_id}}";
    public static final Logger LOGGER = LogUtils.getLogger();

    public {{main_class}}(IEventBus modEventBus, ModContainer modContainer) {
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);
        modEventBus.addListener(ModItems::addCreative);
        LOGGER.info("Initialized {}", MOD_ID);
    }
}
